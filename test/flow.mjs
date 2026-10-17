// End-to-end controller flow without a browser: an utterance must become one
// prompt, a pause inside the grace window must merge, and a rejected filler
// must never send.
import assert from "node:assert/strict"
import vm from "node:vm"
import { readFileSync } from "node:fs"

globalThis.btoa = (value) => Buffer.from(value, "binary").toString("base64")

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
  btoa: globalThis.btoa,
  AbortController,
  AbortSignal,
  OfflineAudioContext: class {},
}
vm.createContext(sandbox)
vm.runInContext(readFileSync(new URL("../lib/client.js", import.meta.url), "utf8"), sandbox)

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
const bundle = entry.factory(() => React)
const { Store, Controller } = bundle.__test

function frames(seconds, rate = 16000) {
  const size = Math.round(rate * 0.1)
  const count = Math.max(1, Math.round(seconds / 0.1))
  return Array.from({ length: count }, () => new Float32Array(size).fill(0.05))
}

function harness(text = "你好世界") {
  const calls = []
  const draft = { value: "" }
  const session = {
    getSnapshot: () => ({ running: false }),
    prompt: async (content, mode) => {
      calls.push({ content, mode })
      return { ok: true }
    },
    cancel: async () => ({ ok: true }),
  }
  const store = new Store({
    phase: "off",
    boundSession: null,
    speechReady: true,
    catalog: null,
    level: 0,
    lastText: "",
    liveText: "",
    message: null,
    dialog: false,
    preparing: false,
    settings: {
      interrupt: "immediate",
      send: "auto",
      sensitivity: "medium",
      silenceMs: 2400,
      live: false,
      mirror: false,
      language: "zh",
    },
    voiceprint: null,
    voiceprintError: null,
  })
  const ctx = {
    sessions: { binding: () => ({ session }), manager: { get: () => session } },
    get: () => undefined,
  }
  const controller = new Controller(ctx, store)
  controller.sessionId = "s1"
  controller.speech = { transcribe: async () => ({ ok: true, value: { text } }) }
  controller.engine = { snapshot: () => null, recentlyVoiced: () => false, vad: { noise: 0.004 } }
  controller.getActions = () => ({
    setDraft() {},
    captureInsertion: () => ({ draftRev: 0 }),
    insertText: () => true,
  })
  controller.getDraft = () => draft.value
  controller.act = {
    token: controller.token,
    phase: "listening",
    lease: null,
    buffer: [],
    bufferSamples: 0,
    hold: null,
    holdTimer: null,
    pending: null,
    previewText: "",
    previewFrameOffset: 0,
    previewTimer: null,
    previewBusy: false,
    previewAbort: null,
    bargeTimer: null,
    cancelPromise: null,
    interrupted: false,
  }
  return { controller, act: controller.act, calls, draft }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// One utterance → exactly one prompt.
{
  const { controller, act, calls } = harness()
  controller.onSpeechStart(act)
  controller.onSegment(act, frames(2), 16000, false)
  await sleep(1400)
  if (calls.length !== 1) {
    console.log("debug", {
      phase: act.phase,
      hold: act.hold === null ? "null" : act.hold.frames.length,
      timer: act.holdTimer,
      message: controller.store.getSnapshot().message,
      lastText: controller.store.getSnapshot().lastText,
    })
  }
  assert.equal(calls.length, 1, `expected one prompt, got ${calls.length}`)
  assert.equal(calls[0].content[0].text, "你好世界")
  assert.equal(calls[0].mode, "queue")
}

// A pause shorter than the grace window merges into the same prompt.
{
  const { controller, act, calls } = harness()
  controller.onSpeechStart(act)
  controller.onSegment(act, frames(2), 16000, false)
  await sleep(300)
  controller.onSpeechStart(act)
  controller.onSegment(act, frames(2), 16000, false)
  await sleep(1400)
  assert.equal(calls.length, 1, `expected merged prompt, got ${calls.length}`)
}

// A filler never sends.
{
  const { controller, act, calls } = harness("嗯")
  controller.onSpeechStart(act)
  controller.onSegment(act, frames(2), 16000, false)
  await sleep(1400)
  assert.equal(calls.length, 0, "filler must not be sent")
}

// Editing the draft after speaking invalidates that utterance.
{
  const { controller, act, calls, draft } = harness("你好世界")
  controller.onSpeechStart(act)
  draft.value = "我自己打的字"
  controller.onSegment(act, frames(2), 16000, false)
  await sleep(1400)
  assert.equal(calls.length, 0, "an edited draft must cancel the voice send")
  assert.equal(controller.store.getSnapshot().message.key, "canceledByEdit")
}

// A duration cap keeps buffering instead of sending.
{
  const { controller, act, calls } = harness()
  controller.onSpeechStart(act)
  controller.onSegment(act, frames(2), 16000, true)
  await sleep(300)
  assert.equal(calls.length, 0, "a capped segment must not send on its own")
  assert.equal(act.bufferSamples > 0, true)
}

console.log("flow ok")
