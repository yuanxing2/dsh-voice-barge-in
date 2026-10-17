// Native end-to-end check for enroll/verify. Needs a local speaker model and
// the sherpa-onnx-node package, so it is not part of CI:
//   node test/voiceprint-native.mjs <modelDir> <sherpaPackageDir>
import assert from "node:assert/strict"
import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { __test } from "../lib/index.js"

const { Voiceprint, MODEL } = __test
const dataRoot = process.argv[2] ?? join(import.meta.dirname, "..", ".tmp-vp")
const sherpaModule = process.argv[3]
if (!sherpaModule) {
  console.log("voiceprint native test skipped (no sherpa package dir)")
  process.exit(0)
}
const modelPath = join(dataRoot, "models", MODEL.file)
mkdirSync(join(dataRoot, "models"), { recursive: true })
if (!existsSync(modelPath)) {
  console.log(`voiceprint native test skipped (missing ${modelPath})`)
  process.exit(0)
}

function wav(samples, sampleRate = 16000) {
  const buffer = Buffer.alloc(44 + samples.length * 2)
  buffer.write("RIFF", 0, "ascii")
  buffer.writeUInt32LE(36 + samples.length * 2, 4)
  buffer.write("WAVE", 8, "ascii")
  buffer.write("fmt ", 12, "ascii")
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write("data", 36, "ascii")
  buffer.writeUInt32LE(samples.length * 2, 40)
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]))
    buffer.writeInt16LE(value < 0 ? Math.trunc(value * 0x8000) : Math.trunc(value * 0x7fff), 44 + index * 2)
  }
  return buffer
}

function tone(frequency, seconds = 2) {
  const samples = new Float32Array(16000 * seconds)
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * frequency * index) / 16000) * 0.25
  }
  return wav(samples).toString("base64")
}

mkdirSync(join(dataRoot, "models"), { recursive: true })

const voiceprint = new Voiceprint(dataRoot, { logger: { warn() {} } }, { sherpaModule })
const first = tone(220)
const second = tone(880)

const enrolled = await voiceprint.dispatch({ action: "enroll", name: "tester", audioBase64: first })
assert.equal(enrolled.speakers.length, 1)
assert.equal(enrolled.model.phase, "ready")

const same = await voiceprint.dispatch({ action: "verify", audioBase64: first })
assert.equal(same.match, true)
assert.ok(same.score > 0.9, `same-sample score ${same.score}`)

const other = await voiceprint.dispatch({ action: "verify", audioBase64: second })
assert.equal(typeof other.score, "number")

console.log(`voiceprint native ok (same=${same.score}, other=${other.score})`)
