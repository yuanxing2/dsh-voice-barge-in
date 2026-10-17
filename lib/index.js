/**
 * Host half: local speaker verification (voiceprint) for the hands-free voice
 * plugin.
 *
 * It loads a CAM++ speaker-embedding model through the `sherpa-onnx-node`
 * runtime that ships with DeepSeek Harness, stores embeddings only (never audio)
 * under the profile data directory, and exposes a small same-origin JSON API on
 * the Harness web server:
 *
 *   POST /voiceprint/api  { action: "state" | "settings" | "prepare" |
 *                           "enroll" | "remove" | "verify", ... }
 *
 * The browser half calls it before sending a transcript when voiceprint is
 * enabled. MIT licensed; see NOTICE.md.
 */
import { createRequire } from "node:module"
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { once } from "node:events"
import { Readable } from "node:stream"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { randomUUID } from "node:crypto"

const MODEL = Object.freeze({
  file: "3dspeaker_campplus_sv_zh_16k.onnx",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx",
  bytes: 28281138,
})

const DEFAULT_THRESHOLD = 0.62
const MAX_BODY_BYTES = 6 * 1024 * 1024
const MIN_SECONDS = 1
const MAX_SECONDS = 15
const TARGET_RATE = 16000

/** Host marker exports for Cordis. */
export const inject = []

/**
 * @param ctx - host plugin context.
 * @param config - `{ dataRoot?: string }` from the bundle patch.
 */
export function apply(ctx, config = {}) {
  const dataRoot = typeof config?.dataRoot === "string" && config.dataRoot !== ""
    ? config.dataRoot
    : join(homedir(), ".dsh", "voiceprint")
  const voiceprint = new Voiceprint(dataRoot, ctx, {
    sherpaModule: typeof config?.sherpaModule === "string" ? config.sherpaModule : undefined,
  })
  ctx.effect(() => () => voiceprint.dispose(), "voiceprint: lifetime")
  ctx.inject(["webServer"], (scope) => {
    scope.effect(
      () => scope.webServer.register({
        kind: "prefix",
        path: "/voiceprint",
        handler: (request, response) => voiceprint.handle(request, response),
      }),
      "voiceprint: http route",
    )
  })
}

class Voiceprint {
  constructor(dataRoot, ctx, options = {}) {
    this.dataRoot = dataRoot
    this.ctx = ctx
    this.sherpaModule = options.sherpaModule
    this.modelPath = join(dataRoot, "models", MODEL.file)
    this.statePath = join(dataRoot, "voiceprints.json")
    this.extractor = undefined
    this.loading = undefined
    this.model = { phase: "missing" }
    this.disposed = false
    this.store = this.readStore()
  }

  readStore() {
    const empty = { version: 1, enabled: true, threshold: DEFAULT_THRESHOLD, speakers: [] }
    try {
      mkdirSync(this.dataRoot, { recursive: true })
      if (!existsSync(this.statePath)) return empty
      const parsed = JSON.parse(readFileSync(this.statePath, "utf8"))
      return {
        version: 1,
        enabled: parsed.enabled !== false,
        threshold: clampThreshold(parsed.threshold),
        speakers: Array.isArray(parsed.speakers)
          ? parsed.speakers
              .filter((speaker) => speaker && typeof speaker.id === "string" && Array.isArray(speaker.embedding))
              .map((speaker) => ({
                id: speaker.id,
                name: String(speaker.name ?? "speaker"),
                createdAt: Number(speaker.createdAt) || Date.now(),
                embedding: speaker.embedding.map(Number),
              }))
          : [],
      }
    } catch (error) {
      this.ctx?.logger?.warn?.(`voiceprint: cannot read ${this.statePath}: ${error.message}`)
      return empty
    }
  }

  persist() {
    mkdirSync(this.dataRoot, { recursive: true })
    const body = JSON.stringify({
      version: 1,
      enabled: this.store.enabled,
      threshold: this.store.threshold,
      speakers: this.store.speakers,
    }, null, 2)
    // Write-then-rename: a crash mid-write must not corrupt the enrollment.
    const temp = `${this.statePath}.tmp`
    writeFileSync(temp, body, "utf8")
    renameSync(temp, this.statePath)
  }

  dispose() {
    this.disposed = true
    this.extractor = undefined
  }

  payload() {
    return {
      ok: true,
      enabled: this.store.enabled,
      threshold: this.store.threshold,
      speakers: this.store.speakers.map((speaker) => ({
        id: speaker.id,
        name: speaker.name,
        createdAt: speaker.createdAt,
        dim: speaker.embedding.length,
      })),
      model: this.model,
      ready: this.model.phase === "ready",
    }
  }

  async handle(request, response) {
    const url = new URL(request.url ?? "/", "http://voiceprint.invalid")
    if (url.pathname !== "/voiceprint/api") {
      send(response, 404, { ok: false, error: "not found" })
      return
    }
    if (request.method !== "POST") {
      send(response, 405, { ok: false, error: "POST only" })
      return
    }
    if (!sameOrigin(request)) {
      send(response, 403, { ok: false, error: "cross-origin request rejected" })
      return
    }
    let body
    try {
      body = await readJson(request)
    } catch (error) {
      send(response, error.status ?? 400, { ok: false, error: error.message })
      return
    }
    try {
      const result = await this.dispatch(body)
      send(response, 200, result)
    } catch (error) {
      send(response, 200, { ok: false, error: error?.message ?? String(error) })
    }
  }

  async dispatch(body) {
    switch (body?.action) {
      case "state":
        return this.payload()
      case "settings":
        return this.updateSettings(body)
      case "prepare":
        void this.ensureModel().catch(() => undefined)
        return this.payload()
      case "enroll":
        return this.enroll(body)
      case "remove":
        return this.remove(body)
      case "verify":
        return this.verify(body)
      default:
        throw new Error(`unknown action: ${String(body?.action)}`)
    }
  }

  updateSettings(body) {
    if (typeof body.enabled === "boolean") this.store.enabled = body.enabled
    if (body.threshold !== undefined) this.store.threshold = clampThreshold(body.threshold)
    this.persist()
    return this.payload()
  }

  async enroll(body) {
    const audio = decodeWav(body.audioBase64)
    const name = String(body.name ?? "").trim().slice(0, 40) || `说话人 ${this.store.speakers.length + 1}`
    const embedding = await this.embed(audio.samples)
    this.store.speakers = [
      ...this.store.speakers.filter((speaker) => speaker.name !== name),
      { id: randomUUID(), name, createdAt: Date.now(), embedding: roundVector(embedding) },
    ]
    this.persist()
    return this.payload()
  }

  remove(body) {
    const id = String(body.id ?? "")
    this.store.speakers = this.store.speakers.filter((speaker) => speaker.id !== id)
    this.persist()
    return this.payload()
  }

  async verify(body) {
    if (!this.store.enabled || this.store.speakers.length === 0) {
      return { ...this.payload(), match: true, skipped: true, score: null, speaker: null }
    }
    const audio = decodeWav(body.audioBase64)
    const embedding = await this.embed(audio.samples)
    let best = { score: -1, speaker: null }
    for (const speaker of this.store.speakers) {
      const score = cosine(embedding, speaker.embedding)
      if (score > best.score) best = { score, speaker }
    }
    return {
      ...this.payload(),
      match: best.score >= this.store.threshold,
      score: Number(best.score.toFixed(4)),
      speaker: best.speaker === null ? null : { id: best.speaker.id, name: best.speaker.name },
    }
  }

  async embed(samples) {
    await this.ensureModel()
    const extractor = this.extractor
    if (extractor === undefined) throw new Error("the speaker model is not loaded")
    // CAM++ only needs a few seconds; clipping keeps a long dictation cheap and
    // avoids feeding minutes of audio into the embedding model.
    const max = TARGET_RATE * 6
    const clipped = samples.length > max ? samples.subarray(0, max) : samples
    const stream = extractor.createStream()
    stream.acceptWaveform({ samples: Float32Array.from(clipped), sampleRate: TARGET_RATE })
    stream.inputFinished()
    if (!extractor.isReady(stream)) {
      throw new Error("the recording is too short for a speaker embedding")
    }
    // `enableExternalBuffer: false` — Electron's V8 rejects external buffers.
    return Array.from(extractor.compute(stream, false))
  }

  async ensureModel() {
    if (this.model.phase === "ready" && this.extractor !== undefined) return
    if (this.loading !== undefined) return this.loading
    this.loading = this.loadModel()
      .catch((error) => {
        this.model = { phase: "failed", error: error?.message ?? String(error) }
        throw error
      })
      .finally(() => {
        this.loading = undefined
      })
    return this.loading
  }

  async loadModel() {
    if (existsSync(this.modelPath) && statSync(this.modelPath).size === MODEL.bytes) {
      // cached
    } else {
      mkdirSync(dirname(this.modelPath), { recursive: true })
      this.model = { phase: "downloading", received: 0, total: MODEL.bytes }
      const response = await fetch(MODEL.url, { redirect: "follow" })
      if (!response.ok || response.body === null) {
        throw new Error(`model download failed: HTTP ${response.status}`)
      }
      const part = `${this.modelPath}.part`
      const output = createWriteStream(part)
      let received = 0
      for await (const chunk of Readable.fromWeb(response.body)) {
        received += chunk.length
        this.model = { phase: "downloading", received, total: MODEL.bytes }
        if (!output.write(chunk)) await once(output, "drain")
      }
      output.end()
      await once(output, "finish")
      if (received !== MODEL.bytes) {
        try {
          unlinkSync(part)
        } catch {
          /* ignore */
        }
        throw new Error(`model size mismatch: got ${received}, expected ${MODEL.bytes}`)
      }
      renameSync(part, this.modelPath)
    }

    this.model = { phase: "loading" }
    const sherpa = await loadSherpa(this.sherpaModule)
    this.extractor = new sherpa.SpeakerEmbeddingExtractor({
      model: this.modelPath,
      numThreads: 2,
      debug: false,
      provider: "cpu",
    })
    this.model = { phase: "ready", received: MODEL.bytes, total: MODEL.bytes }
  }
}

function clampThreshold(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return DEFAULT_THRESHOLD
  return Math.min(0.95, Math.max(0.3, number))
}

function roundVector(vector) {
  return vector.map((value) => Number(Number(value).toFixed(5)))
}

function cosine(a, b) {
  let dot = 0
  let na = 0
  let nb = 0
  const length = Math.min(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index]
    na += a[index] * a[index]
    nb += b[index] * b[index]
  }
  if (na === 0 || nb === 0) return -1
  return dot / Math.sqrt(na * nb)
}

/**
 * Decode the canonical 16 kHz mono PCM16 WAV the browser sends. Mirrors the
 * speech service validation so a malformed body fails before the model runs.
 * @param base64 - base64 WAV payload.
 * @returns `{ samples: Float32Array, seconds: number }`.
 */
function decodeWav(base64) {
  if (typeof base64 !== "string" || base64 === "") throw new Error("audioBase64 is required")
  const buffer = Buffer.from(base64, "base64")
  if (buffer.length < 46 || buffer.length > MAX_BODY_BYTES) throw new Error("invalid audio size")
  const ascii = (offset) => buffer.toString("ascii", offset, offset + 4)
  if (ascii(0) !== "RIFF" || ascii(8) !== "WAVE" || ascii(12) !== "fmt " || ascii(36) !== "data") {
    throw new Error("audio must be a canonical 16 kHz mono PCM16 WAV recording")
  }
  if (buffer.readUInt32LE(16) !== 16 || buffer.readUInt16LE(20) !== 1) throw new Error("unsupported WAV format")
  if (buffer.readUInt16LE(22) !== 1 || buffer.readUInt32LE(24) !== TARGET_RATE) {
    throw new Error("audio must be 16 kHz mono")
  }
  if (buffer.readUInt16LE(34) !== 16) throw new Error("audio must be PCM16")
  if (buffer.readUInt32LE(40) !== buffer.length - 44) throw new Error("WAV data length mismatch")
  const samples = new Float32Array((buffer.length - 44) / 2)
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = buffer.readInt16LE(44 + index * 2) / 32768
  }
  const seconds = samples.length / TARGET_RATE
  if (seconds < MIN_SECONDS) throw new Error("the recording is too short")
  if (seconds > MAX_SECONDS) throw new Error("the recording is too long")
  return { samples, seconds }
}

function sameOrigin(request) {
  const origin = request.headers.origin
  if (typeof origin !== "string" || origin === "") return true
  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}

async function readJson(request) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      const error = new Error("request body is too large")
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }
  if (size === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

function send(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  })
  response.end(body)
}

let sherpaPromise
/** Resolve `sherpa-onnx-node` from the Harness install (asar or a plain install). */
async function loadSherpa(hint) {
  if (hint !== undefined) {
    try {
      const sherpa = createRequire(import.meta.url)(hint)
      if (typeof sherpa?.SpeakerEmbeddingExtractor === "function") return sherpa
    } catch {
      /* fall through to the bundled locations */
    }
  }
  if (sherpaPromise !== undefined) return sherpaPromise
  sherpaPromise = (async () => {
    const attempts = [() => createRequire(import.meta.url)("sherpa-onnx-node")]
    const resources = process.resourcesPath
    if (typeof resources === "string" && resources !== "") {
      const fromAsar = join(resources, "app.asar", "dsh", "node_modules", "resolution-anchor.js")
      const fromResources = join(resources, "dsh", "node_modules", "resolution-anchor.js")
      attempts.push(() => createRequire(fromAsar)("sherpa-onnx-node"))
      attempts.push(() => createRequire(fromResources)("sherpa-onnx-node"))
    }
    const fromProfile = join(homedir(), ".dsh", "profiles", "node_modules", "resolution-anchor.js")
    attempts.push(() => createRequire(fromProfile)("sherpa-onnx-node"))
    let lastError
    for (const attempt of attempts) {
      try {
        const sherpa = attempt()
        if (typeof sherpa?.SpeakerEmbeddingExtractor === "function") return sherpa
        lastError = new Error("SpeakerEmbeddingExtractor is missing from sherpa-onnx-node")
      } catch (error) {
        lastError = error
      }
    }
    throw new Error(`voiceprint: sherpa-onnx-node is unavailable (${lastError?.message ?? "not found"})`)
  })()
  return sherpaPromise
}

export const __test = { decodeWav, cosine, clampThreshold, MODEL, Voiceprint }
