// Smoke tests for the browser bundle. They load the real `lib/client.js` under a
// minimal loader shim, then exercise the pure pieces and the plugin wiring.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import vm from "node:vm"

const code = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8")

let entry
const sandbox = {
  window: { __ModuleLoader__: { load(value) { entry = value } } },
  document: {
    createElement: () => ({ dataset: {}, textContent: "", remove() {} }),
    head: { appendChild() {} },
  },
  navigator: {},
  localStorage: { getItem: () => null, setItem() {} },
  console,
  setTimeout,
  clearTimeout,
  clearInterval,
  btoa: (value) => Buffer.from(value, "binary").toString("base64"),
  OfflineAudioContext: class {},
}
vm.createContext(sandbox)
vm.runInContext(code, sandbox)

assert.equal(entry.id, "dsh-voice-barge-in")

class Component {
  constructor(props) {
    this.props = props
    this.state = {}
  }

  setState() {}
}

const React = {
  Component,
  createElement: (...args) => ({ args }),
  useState: () => [undefined, () => {}],
  useEffect() {},
  useRef: () => ({ current: null }),
  useSyncExternalStore: () => ({}),
}
const exportsObject = entry.factory((id) => {
  assert.equal(id, "react")
  return React
})

assert.equal(typeof exportsObject.apply, "function")
assert.deepEqual([...exportsObject.inject], ["remote", "slots", "locale", "sessions"])

const { encodeWav, EnergyVad } = exportsObject.__test

// --- WAV ---------------------------------------------------------------
{
  const samples = new Float32Array(1600) // 100 ms @ 16 kHz
  samples[0] = 0
  samples[1] = 0.5
  samples[2] = -0.5
  samples[3] = 2 // clipped
  const wav = encodeWav(samples, 16000)
  assert.equal(wav.byteLength, 44 + samples.length * 2)
  const header = Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength)
  assert.equal(header.toString("ascii", 0, 4), "RIFF")
  assert.equal(header.toString("ascii", 8, 12), "WAVE")
  assert.equal(header.toString("ascii", 12, 16), "fmt ")
  assert.equal(header.readUInt32LE(4), 36 + samples.length * 2)
  assert.equal(header.readUInt16LE(20), 1)
  assert.equal(header.readUInt16LE(22), 1)
  assert.equal(header.readUInt32LE(24), 16000)
  assert.equal(header.readUInt32LE(28), 32000)
  assert.equal(header.readUInt16LE(32), 2)
  assert.equal(header.readUInt16LE(34), 16)
  assert.equal(header.readUInt32LE(40), samples.length * 2)
  assert.equal(header.readInt16LE(44 + 2), Math.trunc(0.5 * 0x7fff))
  assert.equal(header.readInt16LE(44 + 4), Math.trunc(-0.5 * 0x8000))
  assert.equal(header.readInt16LE(44 + 6), 0x7fff)
}

// --- VAD ---------------------------------------------------------------
{
  const frameSize = 1024 // 64 ms @ 16 kHz
  const vad = new EnergyVad({ sampleRate: 16000, sensitivity: "medium", silenceMs: 500 })
  const silence = () => new Float32Array(frameSize).fill(0.0008)
  const speech = () => {
    const frame = new Float32Array(frameSize)
    for (let index = 0; index < frame.length; index += 1) frame[index] = Math.sin(index / 6) * 0.08
    return frame
  }
  let started = false
  let ended = null
  for (let index = 0; index < 40; index += 1) {
    const result = vad.push(silence())
    assert.notEqual(result.type, "start")
  }
  for (let index = 0; index < 30; index += 1) {
    const result = vad.push(speech())
    if (result.type === "start") started = true
  }
  assert.equal(started, true)
  for (let index = 0; index < 30; index += 1) {
    const result = vad.push(silence())
    if (result.type === "end") ended = result
  }
  assert.ok(ended, "utterance should end after the hangover")
  assert.ok(ended.frames.length >= 30, `expected frames, got ${ended.frames.length}`)
  assert.ok(ended.speechMs > 1500, "speech duration should cover the voiced frames")
}

// Broadband noise (flat spectrum) must not open an utterance even when loud.
{
  const vad = new EnergyVad({ sampleRate: 16000, sensitivity: "medium", silenceMs: 500 })
  const loudNoise = new Float32Array(1024).fill(0.2)
  let started = false
  for (let index = 0; index < 25; index += 1) {
    if (vad.push(loudNoise, 0.95).type === "start") started = true
  }
  assert.equal(started, false)
}

// The same energy with a speech-like (peaky) spectrum still starts.
{
  const vad = new EnergyVad({ sampleRate: 16000, sensitivity: "medium", silenceMs: 500 })
  const speech = new Float32Array(1024)
  for (let index = 0; index < speech.length; index += 1) speech[index] = Math.sin(index / 5) * 0.12
  let started = false
  for (let index = 0; index < 10; index += 1) {
    if (vad.push(speech, 0.25).type === "start") started = true
  }
  assert.equal(started, true)
}

// --- plugin wiring -----------------------------------------------------
{
  const registered = []
  const effects = []
  let speechCallback
  const fakeSession = { getSnapshot: () => ({ running: false }), prompt: async () => ({ ok: true }), cancel: async () => ({ ok: true }) }
  const ctx = {
    effect(fn) {
      effects.push(fn())
    },
    inject(deps, run) {
      assert.deepEqual([...deps], ["remote.speech"])
      speechCallback = () => {
        const scope = {
          remote: {
            speech: {
              catalog: async () => ({ ok: true, value: { providers: [], selection: { providerId: "x", language: "zh" } } }),
            },
          },
          effect(fn) {
            effects.push(fn())
          },
        }
        run(scope)
      }
    },
    get() {
      return undefined
    },
    slots: {
      inject(name, run) {
        assert.ok(
          name === "conversation.input.right" || name === "conversation.composer.dock",
          `unexpected slot ${name}`,
        )
        assert.equal(typeof run(), "function")
      },
      register(options, component) {
        assert.ok(
          options.name === "conversation.input.right" || options.name === "conversation.composer.dock",
          `unexpected slot ${options.name}`,
        )
        assert.equal(options.locale, "dsh-voice-barge-in")
        registered.push({ options, component })
        return () => {}
      },
    },
    locale: { register(namespace) { assert.equal(namespace, "dsh-voice-barge-in"); return () => {} } },
    sessions: { binding: () => ({ session: fakeSession }) },
  }
  exportsObject.apply(ctx)
  assert.equal(effects.length >= 2, true)
  assert.equal(registered.length, 2)
  assert.equal(typeof speechCallback, "function")
  speechCallback()
}

console.log("smoke ok")
