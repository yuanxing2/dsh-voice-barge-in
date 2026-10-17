/**
 * Hands-free voice input with barge-in for DeepSeek Harness.
 *
 * Browser half of the `dsh-voice-barge-in` bundle. It reuses the experimental
 * speech-to-text service (local SenseVoice) through the `speech` API Remote
 * mounted by the official voice-input plugin, adds continuous microphone
 * capture with an energy VAD, and delivers every finished utterance as a
 * prompt: `steer` while the agent is running, `queue` otherwise.
 *
 * Bundle protocol: the shell materializes this file through
 * `window.__ModuleLoader__.load({ id, factory })`; the factory only registers
 * the plugin, all side effects live inside it. `require` resolves against the
 * frozen platform module table (react, zod, ...).
 */
window.__ModuleLoader__.load({
  id: "dsh-voice-barge-in",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })

    const React = require("react")
    const h = React.createElement

    //#region constants

    const NS = "dsh-voice-barge-in"
    const SETTINGS_KEY = "dsh.voice-barge-in.settings.v1"

    const DEFAULTS = Object.freeze({
      interrupt: "immediate", // immediate | after
      send: "auto", // auto | draft
      sensitivity: "medium", // low | medium | high
      silenceMs: 2400,
      live: true,
      mirror: true,
      language: typeof navigator !== "undefined" && String(navigator.language || "").toLowerCase().startsWith("zh")
        ? "zh"
        : "auto",
    })

    const LANGUAGES = [
      { value: "auto", labelKey: "langAuto" },
      { value: "zh", labelKey: "langZh" },
      { value: "en", labelKey: "langEn" },
      { value: "yue", labelKey: "langYue" },
      { value: "ja", labelKey: "langJa" },
      { value: "ko", labelKey: "langKo" },
    ]

    const SILENCE_CHOICES = [1200, 1600, 2000, 2400, 3000]
    const STEP_KEYS = { check: "stepCheck", model: "stepModel", vad: "stepVad", verify: "stepVerify", load: "stepLoad" }
    const SENSITIVITY_FACTOR = { low: 2.2, medium: 1, high: 0.55 }
    const FLATNESS_MAX = { low: 0.6, medium: 0.75, high: 0.85 }
    const MAX_AUDIO_BYTES = 4 * 1024 * 1024
    const TARGET_RATE = 16000
    const FRAME_SIZE = 1024
    const MAX_UTTERANCE_MS = 60000
    const MAX_MERGED_SECONDS = 100
    const MIN_SPEECH_MS = 220
    const PREROLL_MS = 2500
    const ONSET_FRAMES = 2
    const BARGE_IN_DELAY_MS = 700
    const PAUSE_GRACE_MS = 500
    const FILLERS = new Set([
      "嗯", "嗯嗯", "啊", "啊啊", "哦", "哦哦", "呃", "呃呃", "唉", "诶", "哎", "嗷", "嘶", "哈", "哈哈",
      "oh", "uh", "um", "hmm", "mm", "huh", "ah", "eh",
    ])
    const STOP_WORDS = new Set([
      "停", "停下", "停一下", "停止", "别", "别做了", "不要了", "暂停", "取消", "算了",
      "stop", "cancel", "halt",
    ])

    //#endregion

    //#region dictionaries

    const zh = {
      toggle: "免提语音",
      toggleOff: "关闭免提语音",
      hint: "持续聆听，说完自动发送；说话会打断正在生成的回复",
      busyOther: "免提语音已在另一个会话中开启",
      dialogTitle: "免提语音",
      starting: "正在启动麦克风…",
      warming: "正在准备识别模型…",
      captionStarting: "正在准备麦克风…",
      listening: "正在聆听",
      transcribing: "正在识别…",
      sending: "正在发送…",
      off: "已关闭",
      unavailable: "未检测到语音服务",
      unavailableHint: "请先在插件页启用官方「语音输入」插件，它提供本地语音识别与语音 API。",
      openVoicePlugin: "打开语音插件",
      needModel: "本地识别模型尚未准备",
      needModelHint: "首次使用需要下载 SenseVoice 模型（约 240 MB，仅一次；离线识别，音频不离开本机）。",
      modelFailed: "模型准备失败：{message}",
      prepare: "下载并准备",
      preparing: "正在准备模型…",
      cancelPrepare: "取消准备",
      downloadProgress: "已下载 {done} / {total}",
      empty: "没有听清，请再说一次（音频 {seconds}s）",
      ignored: "已忽略语气词，未发送",
      nonsense: "已忽略无法识别为语言的声音",
      stopped: "已停止当前回合",
      canceledByEdit: "输入框已被你修改，这条语音不再发送",
      stillListening: "句子较长，还在继续听…",
      emptyAfterInterrupt: "没有听清；当前回复已停止",
      interrupted: "已打断当前回复",
      drafted: "已填入草稿",
      micDenied: "麦克风权限被拒绝，请在浏览器地址栏重新允许",
      micFailed: "无法使用麦克风：{message}",
      transcribeFailed: "识别失败：{message}",
      sendFailed: "发送失败：{message}",
      interrupt: "打断方式",
      interruptImmediate: "立即打断",
      interruptAfter: "说完插话",
      interruptImmediateHint: "检测到说话就停止当前回合，识别完成后发送",
      interruptAfterHint: "等你说完并识别完成，再打断当前回合并发送",
      send: "识别后",
      sendAuto: "自动发送",
      sendDraft: "只填草稿",
      sendAutoHint: "识别完成立即作为消息发送",
      sendDraftHint: "只把文字插入输入框，由你确认后发送",
      sensitivity: "灵敏度",
      low: "低",
      medium: "中",
      high: "高",
      silence: "静音断句",
      silenceHint: "停止说话多久算一句话结束；觉得断得太快就调长",
      seconds: "{value} 秒",
      mirror: "写入输入框",
      mirrorOn: "开",
      mirrorOff: "关",
      mirrorHint: "说话时把识别文字实时写进输入框；仅当输入框为空时接管，你一开始打字就自动让出",
      language: "识别语言",
      langAuto: "自动",
      langZh: "中文",
      langEn: "English",
      langYue: "粤语",
      langJa: "日本語",
      langKo: "한국어",
      languageHint: "固定成你常说的语言，短句识别会明显更准",
      live: "实时字幕",
      liveOn: "开",
      liveOff: "关",
      liveHint: "说话过程中约每秒把已说的部分显示在输入框下方（整段识别器的折中，延迟约 1 秒，不是逐字）",
      captionListening: "正在聆听…",
      captionTranscribing: "正在识别…",
      captionPrefix: "听到：",
      voiceprint: "声纹",
      vpOn: "开",
      vpOff: "关",
      vpHint: "只接受已注册说话人的声音；只保存声纹向量，不保存录音",
      vpUnavailable: "声纹服务未加载（重启 Harness 后可用）",
      vpModelReady: "声纹模型已就绪",
      vpPrepare: "下载声纹模型（27 MB）",
      vpDownloading: "正在下载声纹模型：{done} / {total}",
      vpLoading: "正在加载声纹模型…",
      vpFailed: "声纹模型失败：{message}",
      vpThreshold: "相似度阈值",
      vpThresholdHint: "越高越严格；建议 0.60–0.70",
      vpSpeakers: "已注册说话人",
      vpNoSpeakers: "还没有注册说话人",
      vpName: "名字",
      vpEnroll: "录制 6 秒注册",
      vpEnrolling: "录制中：还有 {seconds} 秒…",
      vpEnrollHint: "用正常语速读一段话，环境尽量安静",
      vpRemove: "删除",
      vpRejected: "声纹不匹配（相似度 {score}），未发送",
      vpEnrolled: "已注册：{name}",
      vpError: "声纹失败：{message}",
      vpRetry: "重试",
      ms: "{value} 毫秒",
      lastHeard: "最近识别",
      none: "暂无",
      close: "关闭",
      settings: "设置",
      privacy: "麦克风只在免提开启时使用，页面切到后台会自动关闭。",
      modelReady: "识别模型已就绪",
      providerUnknown: "语音服务已连接，但没有可用的识别器",
      preparingHint: "下载完成后会自动继续；可以随时关闭此窗口。",
      language: "识别语言",
      languageFollow: "跟随语音插件设置（{language}）",
      preparingStep: "准备中：{step}",
      stepCheck: "检查缓存",
      stepModel: "下载模型",
      stepVad: "下载语音检测模型",
      stepVerify: "校验文件",
      stepLoad: "加载模型",
    }

    const en = {
      toggle: "Hands-free voice",
      toggleOff: "Turn off hands-free voice",
      hint: "Always listening; sends when you stop speaking and interrupts the running turn",
      busyOther: "Hands-free voice is on in another session",
      dialogTitle: "Hands-free voice",
      starting: "Starting microphone…",
      warming: "Preparing the recognition model…",
      captionStarting: "Preparing microphone…",
      listening: "Listening",
      transcribing: "Transcribing…",
      sending: "Sending…",
      off: "Off",
      unavailable: "Speech service not detected",
      unavailableHint: "Enable the official Voice Input plugin first; it provides local speech recognition and the speech API.",
      openVoicePlugin: "Open Voice Input plugin",
      needModel: "The local recognition model is not prepared",
      needModelHint: "First use downloads the SenseVoice model (~240 MB, once; runs offline, audio never leaves this machine).",
      modelFailed: "Model preparation failed: {message}",
      prepare: "Download and prepare",
      preparing: "Preparing model…",
      cancelPrepare: "Cancel preparation",
      downloadProgress: "Downloaded {done} / {total}",
      empty: "I didn't catch that. Please say it again ({seconds}s of audio).",
      ignored: "Ignored a filler word; nothing was sent",
      nonsense: "Ignored a sound that is not speech",
      stopped: "Stopped the running turn",
      canceledByEdit: "You edited the draft, so this utterance was not sent",
      stillListening: "Long sentence — still listening…",
      emptyAfterInterrupt: "I didn't catch that; the running reply was stopped.",
      interrupted: "Interrupted the running reply",
      drafted: "Inserted into the draft",
      micDenied: "Microphone permission was denied. Allow it in the address bar.",
      micFailed: "Microphone unavailable: {message}",
      transcribeFailed: "Transcription failed: {message}",
      sendFailed: "Could not send: {message}",
      interrupt: "Barge-in",
      interruptImmediate: "Interrupt on speech",
      interruptAfter: "Interrupt after speaking",
      interruptImmediateHint: "Stop the running turn as soon as speech is detected, then send after transcription",
      interruptAfterHint: "Wait for the transcription, then interrupt the running turn and send",
      send: "After recognition",
      sendAuto: "Send automatically",
      sendDraft: "Fill draft only",
      sendAutoHint: "Send the transcript as a message immediately",
      sendDraftHint: "Insert the transcript into the composer for you to confirm",
      sensitivity: "Sensitivity",
      low: "Low",
      medium: "Medium",
      high: "High",
      silence: "End of speech",
      silenceHint: "How much silence ends one utterance; raise it if it cuts you off",
      seconds: "{value}s",
      mirror: "Write into input",
      mirrorOn: "On",
      mirrorOff: "Off",
      mirrorHint: "Types the live transcript into the composer; only takes over an empty draft and yields as soon as you type",
      language: "Recognition language",
      langAuto: "Auto",
      langZh: "中文",
      langEn: "English",
      langYue: "粤语",
      langJa: "日本語",
      langKo: "한국어",
      languageHint: "Pin the language you actually speak; short utterances get much more accurate",
      live: "Live captions",
      liveOn: "On",
      liveOff: "Off",
      liveHint: "Shows what you have said so far about once a second below the input (whole-file recognizer, ~1 s behind, not word-by-word)",
      captionListening: "Listening…",
      captionTranscribing: "Transcribing…",
      captionPrefix: "Heard: ",
      voiceprint: "Voiceprint",
      vpOn: "On",
      vpOff: "Off",
      vpHint: "Only accept registered speakers; stores embeddings, never audio",
      vpUnavailable: "Voiceprint service is not loaded (restart Harness)",
      vpModelReady: "Voiceprint model ready",
      vpPrepare: "Download voiceprint model (27 MB)",
      vpDownloading: "Downloading voiceprint model: {done} / {total}",
      vpLoading: "Loading voiceprint model…",
      vpFailed: "Voiceprint model failed: {message}",
      vpThreshold: "Match threshold",
      vpThresholdHint: "Higher is stricter; 0.60–0.70 works well",
      vpSpeakers: "Registered speakers",
      vpNoSpeakers: "No speakers registered yet",
      vpName: "Name",
      vpEnroll: "Record 6 s to enroll",
      vpEnrolling: "Recording: {seconds}s left…",
      vpEnrollHint: "Read a sentence at normal speed in a quiet room",
      vpRemove: "Remove",
      vpRejected: "Voiceprint mismatch ({score}); not sent",
      vpEnrolled: "Enrolled: {name}",
      vpError: "Voiceprint failed: {message}",
      vpRetry: "Retry",
      ms: "{value} ms",
      lastHeard: "Last transcript",
      none: "None",
      close: "Close",
      settings: "Settings",
      privacy: "The microphone is used only while hands-free is on; hiding the page turns it off.",
      modelReady: "Recognition model is ready",
      providerUnknown: "Speech service connected, but no recognizer is available",
      preparingHint: "It continues automatically after the download; you can close this window.",
      language: "Language",
      languageFollow: "Follows the Voice Input plugin ({language})",
      preparingStep: "Preparing: {step}",
      stepCheck: "checking cache",
      stepModel: "downloading model",
      stepVad: "downloading VAD model",
      stepVerify: "verifying files",
      stepLoad: "loading model",
    }

    //#endregion

    //#region pure helpers

    function shallowEqual(a, b) {
      if (a === b) return true
      if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
      const ka = Object.keys(a)
      const kb = Object.keys(b)
      if (ka.length !== kb.length) return false
      for (const key of ka) if (!Object.is(a[key], b[key])) return false
      return true
    }

    class Store {
      constructor(initial) {
        this.value = initial
        this.listeners = new Set()
        this.subscribe = (listener) => {
          this.listeners.add(listener)
          return () => {
            this.listeners.delete(listener)
          }
        }
        this.getSnapshot = () => this.value
      }
      set(patch) {
        const next = typeof patch === "function" ? patch(this.value) : { ...this.value, ...patch }
        if (shallowEqual(next, this.value)) return
        this.value = next
        for (const listener of [...this.listeners]) listener()
      }
    }

    function clampSample(value) {
      return value > 1 ? 1 : value < -1 ? -1 : value
    }

    function encodeWav(samples, sampleRate) {
      const rate = sampleRate || TARGET_RATE
      const dataBytes = samples.length * 2
      const buffer = new ArrayBuffer(44 + dataBytes)
      const view = new DataView(buffer)
      const ascii = (offset, text) => {
        for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index))
      }
      ascii(0, "RIFF")
      view.setUint32(4, 36 + dataBytes, true)
      ascii(8, "WAVE")
      ascii(12, "fmt ")
      view.setUint32(16, 16, true)
      view.setUint16(20, 1, true)
      view.setUint16(22, 1, true)
      view.setUint32(24, rate, true)
      view.setUint32(28, rate * 2, true)
      view.setUint16(32, 2, true)
      view.setUint16(34, 16, true)
      ascii(36, "data")
      view.setUint32(40, dataBytes, true)
      let offset = 44
      for (let index = 0; index < samples.length; index += 1) {
        const sample = clampSample(samples[index])
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
        offset += 2
      }
      return new Uint8Array(buffer)
    }

    function toBase64(bytes) {
      let binary = ""
      const chunk = 8192
      for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk))
      }
      return btoa(binary)
    }

    function mergeFrames(frames) {
      let length = 0
      for (const frame of frames) length += frame.length
      const merged = new Float32Array(length)
      let offset = 0
      for (const frame of frames) {
        merged.set(frame, offset)
        offset += frame.length
      }
      return merged
    }

    async function resampleTo16k(frames, inputRate) {
      const merged = mergeFrames(frames)
      if (merged.length === 0) return merged
      if (!inputRate || Math.abs(inputRate - TARGET_RATE) < 1) return merged
      const length = Math.max(1, Math.round((merged.length * TARGET_RATE) / inputRate))
      const context = new OfflineAudioContext(1, length, TARGET_RATE)
      const buffer = context.createBuffer(1, merged.length, inputRate)
      buffer.copyToChannel(merged, 0)
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(context.destination)
      source.start()
      const rendered = await context.startRendering()
      return rendered.getChannelData(0).slice()
    }

    function rmsOf(frame) {
      let sum = 0
      for (let index = 0; index < frame.length; index += 1) sum += frame[index] * frame[index]
      return Math.sqrt(sum / frame.length)
    }

    function readSettings() {
      try {
        const raw = window.localStorage.getItem(SETTINGS_KEY)
        if (!raw) return { ...DEFAULTS }
        const parsed = JSON.parse(raw)
        const settings = { ...DEFAULTS }
        if (parsed?.interrupt === "after" || parsed?.interrupt === "immediate") settings.interrupt = parsed.interrupt
        if (parsed?.send === "draft" || parsed?.send === "auto") settings.send = parsed.send
        if (parsed?.sensitivity === "low" || parsed?.sensitivity === "medium" || parsed?.sensitivity === "high") {
          settings.sensitivity = parsed.sensitivity
        }
        if (SILENCE_CHOICES.includes(parsed?.silenceMs)) settings.silenceMs = parsed.silenceMs
        // v1 shipped 1.6 s as the default; users who never touched it get the
        // calmer 2.4 s default so short pauses stop splitting sentences.
        if (parsed?._v === undefined && parsed?.silenceMs === 1600) settings.silenceMs = 2400
        if (typeof parsed?.live === "boolean") settings.live = parsed.live
        if (typeof parsed?.mirror === "boolean") settings.mirror = parsed.mirror
        if (LANGUAGES.some((item) => item.value === parsed?.language)) settings.language = parsed.language
        return settings
      } catch {
        return { ...DEFAULTS }
      }
    }

    function saveSettings(settings) {
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, _v: 2 }))
      } catch {
        /* private mode: keep in memory */
      }
    }

    //#endregion

    //#region voiceprint api

    const VOICEPRINT_ENDPOINT = "/voiceprint/api"

    async function voiceprintCall(body) {
      const response = await fetch(VOICEPRINT_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw new Error(`voiceprint HTTP ${response.status}`)
      const payload = await response.json()
      if (!payload.ok) throw new Error(payload.error || "voiceprint request failed")
      return payload
    }

    //#endregion

    //#region VAD

    /**
     * Energy VAD with an adaptive noise floor. It purposefully stays linear and
     * dependency-free: one utterance is a run of voiced frames terminated by
     * `silenceMs` of quiet or by `maxUtteranceMs`.
     */
    class EnergyVad {
      constructor(options) {
        const {
          sampleRate,
          frameSize = FRAME_SIZE,
          sensitivity = "medium",
          silenceMs = 800,
          minSpeechMs = MIN_SPEECH_MS,
          maxUtteranceMs = MAX_UTTERANCE_MS,
          prerollMs = PREROLL_MS,
        } = options
        this.frameMs = (frameSize / sampleRate) * 1000
        this.factor = SENSITIVITY_FACTOR[sensitivity] ?? SENSITIVITY_FACTOR.medium
        this.flatnessMax = FLATNESS_MAX[sensitivity] ?? FLATNESS_MAX.medium
        this.hangover = Math.max(1, Math.round(silenceMs / this.frameMs))
        this.minSpeech = Math.max(1, Math.round(minSpeechMs / this.frameMs))
        this.maxFrames = Math.max(this.minSpeech, Math.round(maxUtteranceMs / this.frameMs))
        this.prerollLimit = Math.max(0, Math.round(prerollMs / this.frameMs))
        this.noise = 0.004
        this.preroll = []
        this.frames = []
        this.speaking = false
        this.onset = 0
        this.silence = 0
        this.voiced = 0
        this.lastVoicedAt = 0
        this.flatSuspect = 0
        this.spectralOff = false
      }

      reset() {
        this.preroll = []
        this.frames = []
        this.speaking = false
        this.onset = 0
        this.silence = 0
        this.voiced = 0
      }

      configure(settings) {
        this.factor = SENSITIVITY_FACTOR[settings.sensitivity] ?? SENSITIVITY_FACTOR.medium
        this.flatnessMax = FLATNESS_MAX[settings.sensitivity] ?? FLATNESS_MAX.medium
        this.hangover = Math.max(1, Math.round(settings.silenceMs / this.frameMs))
      }

      push(frame, flatness) {
        const rms = rmsOf(frame)
        const threshold = Math.max(0.003, this.noise * 2.8) * this.factor
        // Speech is peaky (low spectral flatness); fans, hiss and wind are flat.
        // If the analyser keeps reporting a perfectly flat spectrum on loud audio
        // for seconds, treat it as unavailable and fall back to energy only.
        if (!this.spectralOff && flatness !== undefined) {
          if (flatness >= 0.999 && rms > threshold) this.flatSuspect += 1
          else this.flatSuspect = 0
          if (this.flatSuspect > 60) this.spectralOff = true
        }
        const speechLike = this.spectralOff || flatness === undefined || flatness <= this.flatnessMax
        const loud = rms > threshold
        // Spectral shape only guards the onset: once an utterance is open, a frame
        // counts as speech whenever it is loud enough. Otherwise a misclassified
        // frame ends the utterance early and pauses split one sentence in two.
        const active = this.speaking ? loud : loud && speechLike
        if (active) this.lastVoicedAt = Date.now()

        if (!loud) {
          if (rms < this.noise) this.noise = this.noise * 0.8 + rms * 0.2
          else this.noise = this.noise * 0.995 + rms * 0.005
          this.noise = Math.max(0.0008, Math.min(this.noise, 0.06))
        } else if (!this.speaking && !active) {
          // Loud but clearly non-speech (flat spectrum): track it as noise so a
          // noisy room does not keep the onset threshold artificially low.
          this.noise = Math.max(0.0008, Math.min(this.noise * 1.01, 0.06))
        }

        if (!this.speaking) {
          this.preroll.push(frame)
          while (this.preroll.length > this.prerollLimit) this.preroll.shift()
          this.onset = active ? this.onset + 1 : 0
          if (this.onset >= ONSET_FRAMES) {
            this.speaking = true
            this.frames = this.preroll.slice()
            this.preroll = []
            this.silence = 0
            this.voiced = this.onset
            return { type: "start", level: rms }
          }
          return { type: "level", level: rms }
        }

        this.frames.push(frame)
        if (active) {
          this.voiced += 1
          this.silence = 0
        } else {
          this.silence += 1
        }

        if (this.frames.length >= this.maxFrames) {
          const frames = this.frames
          const speechMs = this.voiced * this.frameMs
          this.reset()
          return { type: "end", frames, speechMs, cut: true, level: rms }
        }
        if (this.silence >= this.hangover) {
          const frames = this.frames
          const speechMs = this.voiced * this.frameMs
          const speechFrames = this.frames.length - this.silence
          this.reset()
          if (speechFrames < this.minSpeech) return { type: "discard", level: rms }
          return { type: "end", frames, speechMs, cut: false, level: rms }
        }
        return { type: "level", level: rms }
      }
    }

    //#endregion

    //#region microphone

    class MicEngine {
      constructor(handlers) {
        this.handlers = handlers
        this.stream = null
        this.audio = null
        this.source = null
        this.highpass = null
        this.processor = null
        this.gain = null
        this.analyser = null
        this.spectrum = null
        this.vad = null
        this.running = false
        this.stopping = null
      }

      async start(settings) {
        if (this.running) return
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("getUserMedia is unavailable in this browser")
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        })
        const Ctor = window.AudioContext || window.webkitAudioContext
        const audio = new Ctor()
        try {
          if (audio.state === "suspended") await audio.resume()
          const source = audio.createMediaStreamSource(stream)
          const highpass = audio.createBiquadFilter()
          highpass.type = "highpass"
          highpass.frequency.value = 85
          highpass.Q.value = 0.7
          const processor = audio.createScriptProcessor(FRAME_SIZE, 1, 1)
          const gain = audio.createGain()
          gain.gain.value = 0
          const analyser = audio.createAnalyser()
          analyser.fftSize = 1024
          analyser.smoothingTimeConstant = 0.2
          this.vad = new EnergyVad({
            sampleRate: audio.sampleRate,
            sensitivity: settings.sensitivity,
            silenceMs: settings.silenceMs,
          })
          processor.onaudioprocess = (event) => this.consume(event)
          source.connect(highpass)
          highpass.connect(processor)
          processor.connect(gain)
          gain.connect(audio.destination)
          // Spectral branch: keeps the analyser pulled without adding sound.
          highpass.connect(analyser)
          analyser.connect(gain)
          this.stream = stream
          this.audio = audio
          this.source = source
          this.highpass = highpass
          this.processor = processor
          this.gain = gain
          this.analyser = analyser
          this.spectrum = new Float32Array(analyser.frequencyBinCount)
          this.running = true
          // Wait for the first real audio callback: on some Windows drivers the
          // first few hundred milliseconds after getUserMedia are silent, which
          // is exactly what cuts the head off the first sentence.
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 1200)
            const original = processor.onaudioprocess
            processor.onaudioprocess = (event) => {
              clearTimeout(timer)
              processor.onaudioprocess = original
              original(event)
              resolve()
            }
          })
        } catch (error) {
          try {
            await audio.close()
          } catch {
            /* already closed */
          }
          for (const track of stream.getTracks()) track.stop()
          throw error
        }
      }

      /**
       * Spectral flatness of the last analyser window: near 1 for broadband
       * noise, well below 1 for harmonic speech. Undefined without an analyser.
       */
      spectralFlatness() {
        const analyser = this.analyser
        const spectrum = this.spectrum
        if (!analyser || !spectrum) return undefined
        analyser.getFloatFrequencyData(spectrum)
        let logSum = 0
        let sum = 0
        let count = 0
        for (let index = 1; index < spectrum.length; index += 1) {
          const decibels = spectrum[index]
          const power = Number.isFinite(decibels) ? Math.pow(10, decibels / 10) : 1e-10
          logSum += Math.log(power + 1e-10)
          sum += power
          count += 1
        }
        if (count === 0 || sum <= 0) return 1
        return Math.min(1, Math.exp(logSum / count) / (sum / count + 1e-12))
      }

      consume(event) {
        if (!this.running || !this.vad) return
        const input = event.inputBuffer.getChannelData(0)
        const frame = new Float32Array(input.length)
        frame.set(input)
        const result = this.vad.push(frame, this.spectralFlatness())
        if (result.type === "level") {
          this.handlers.onLevel(result.level)
        } else if (result.type === "start") {
          this.handlers.onLevel(result.level)
          this.handlers.onSpeechStart()
        } else if (result.type === "discard") {
          this.handlers.onLevel(0)
        } else if (result.type === "end") {
          this.handlers.onLevel(0)
          this.handlers.onUtterance(result.frames, this.audio?.sampleRate || TARGET_RATE, result.speechMs, result.cut)
        }
      }

      /** True when voiced audio arrived within `windowMs` (hysteresis still holds `speaking`). */
      recentlyVoiced(windowMs = 400) {
        return this.vad !== null && Date.now() - this.vad.lastVoicedAt < windowMs
      }

      updateSettings(settings) {
        this.vad?.configure(settings)
      }

      /** Copy of the in-progress utterance, for live captions. */
      snapshot() {
        if (!this.running || !this.vad || !this.vad.speaking) return null
        return {
          frames: this.vad.frames.slice(),
          sampleRate: this.audio?.sampleRate || TARGET_RATE,
        }
      }

      async stop() {
        if (this.stopping) return this.stopping
        this.running = false
        const audio = this.audio
        const stream = this.stream
        const source = this.source
        const highpass = this.highpass
        const processor = this.processor
        const gain = this.gain
        const analyser = this.analyser
        this.audio = null
        this.stream = null
        this.source = null
        this.highpass = null
        this.processor = null
        this.gain = null
        this.analyser = null
        this.spectrum = null
        this.vad = null
        this.stopping = (async () => {
          try {
            if (processor) processor.onaudioprocess = null
            source?.disconnect()
            highpass?.disconnect()
            processor?.disconnect()
            gain?.disconnect()
            analyser?.disconnect()
          } catch {
            /* nodes may already be gone */
          }
          for (const track of stream?.getTracks() ?? []) track.stop()
          try {
            await audio?.close()
          } catch {
            /* ignore */
          }
          this.stopping = null
        })()
        await this.stopping
      }
    }

    //#endregion

    //#region controller

    /**
     * One activation = one hands-free session. Every async hop carries `token`;
     * when the activation ends, every late callback is discarded.
     *
     *   starting → listening ⇄ (segment) → transcribing → sending → listening
     *
     * Invariants:
     * - at most one ASR request of each kind (preview / final) in flight;
     *   preview results are merged into the preview text, never sent;
     * - the composer is written through a single lease; the lease yields the
     *   moment the user edits the draft;
     * - barge-in is decided in one place (onSpeechStart) and the send path is the
     *   only place that turns a transcript into a prompt.
     */
    class Controller {
      constructor(ctx, store) {
        this.ctx = ctx
        this.store = store
        this.settings = store.getSnapshot().settings
        this.speech = undefined
        this.catalog = null
        this.engine = null
        this.sessionId = null
        this.getActions = null
        this.getDraft = null
        this.act = null
        this.token = 0
        this.prepPoll = null
        this.voiceprint = null
        this.voiceprintError = null
        this.voiceprintPoll = null
        this.thresholdTimer = null
        this.enrolling = false
        this.lastLevelAt = 0
        this.warmedFor = undefined
      }

      // ---------------------------------------------------------------- speech

      attachSpeech(speech) {
        this.speech = speech
        void this.refresh()
      }

      detachSpeech() {
        this.speech = undefined
        this.catalog = null
        if (this.act) void this.disable()
        this.store.set({ speechReady: false })
      }

      provider() {
        const catalog = this.catalog
        if (!catalog) return undefined
        return catalog.providers.find((item) => item.id === catalog.selection.providerId)
      }

      language() {
        const value = this.settings.language
        if (typeof value === "string" && value !== "" && value !== "auto") return value
        return this.catalog?.selection?.language ?? "auto"
      }

      async refresh() {
        if (!this.speech) return null
        const result = await this.speech.catalog()
        if (!result.ok) {
          this.store.set({ speechReady: false })
          return null
        }
        this.catalog = result.value
        this.store.set({ speechReady: true, catalog: result.value })
        return result.value
      }

      /**
       * Warm the recognizer once per attached service. The first transcription
       * otherwise pays worker spawn + model load, which is what makes the very
       * first sentence behave differently from the rest.
       */
      async warmRecognition() {
        if (!this.speech || this.warmedFor === this.speech) return
        this.warmedFor = this.speech
        try {
          const silence = encodeWav(new Float32Array(TARGET_RATE * 0.3), TARGET_RATE)
          await this.speech.transcribe(
            { audioBase64: toBase64(silence), language: this.language() },
            AbortSignal.timeout(2500),
          )
        } catch {
          /* cold start is best effort */
        }
      }

      // -------------------------------------------------------------- settings

      settingsPatch(patch) {
        this.settings = { ...this.settings, ...patch }
        saveSettings(this.settings)
        this.store.set({ settings: this.settings })
        this.engine?.updateSettings(this.settings)
        if (Object.hasOwn(patch, "live") || Object.hasOwn(patch, "mirror")) {
          this.restartPreview()
        }
      }

      async openVoicePlugin() {
        try {
          this.ctx.get("pluginNavigation")?.openBundle?.("@deepseek-ai/dsh-experimental-voice-input-bundle")
        } catch {
          /* navigation is optional */
        }
      }

      // -------------------------------------------------------------- composer

      attachComposer(sessionId, getActions, getDraft) {
        this.sessionId = sessionId
        this.getActions = getActions
        this.getDraft = getDraft
      }

      releaseSession(sessionId) {
        if (this.sessionId !== sessionId) return
        if (this.act) void this.disable()
        this.sessionId = null
        this.getActions = null
        this.getDraft = null
      }

      draftText() {
        return String(this.getDraft?.() ?? "")
      }

      /** Take a lease on an empty composer draft for this utterance. */
      acquireLease(act) {
        const actions = this.getActions?.()
        if (!actions?.setDraft) return
        const base = this.draftText()
        if (base.trim() !== "") {
          act.lease = { base, written: base, active: false, lost: false, updatedAt: Date.now() }
          return
        }
        act.lease = { base: "", written: "", active: true, lost: false, updatedAt: Date.now() }
      }

      leaseWritable(act) {
        const lease = act.lease
        if (!lease?.active) return false
        const current = this.draftText()
        if (current === lease.written) return true
        // The editor store can lag one tick behind setDraft().
        if (lease.written !== "" && lease.written.startsWith(current)) return true
        lease.active = false
        lease.lost = true
        return false
      }

      /**
       * True when the user touched the draft after we wrote it. Such an utterance
       * must not be sent later, even if its transcription arrives minutes later.
       */
      leaseLost(act) {
        const lease = act.lease
        if (!lease) return false
        if (lease.lost) return true
        const current = this.draftText()
        if (current === lease.written) return false
        if (lease.written !== "" && lease.written.startsWith(current)) {
          // Empty/short draft right after our write is usually editor lag.
          return current === "" && Date.now() - (lease.updatedAt ?? 0) > 400
        }
        lease.lost = true
        return true
      }

      writeLease(act, text) {
        if (!this.leaseWritable(act)) return false
        try {
          this.getActions().setDraft(text)
          act.lease.written = text
          act.lease.updatedAt = Date.now()
          return true
        } catch {
          act.lease.active = false
          act.lease.lost = true
          return false
        }
      }

      /** Drop the lease, clearing the draft only when it still holds our text. */
      releaseLease(act, clear) {
        const lease = act?.lease
        if (!lease) return
        if (clear && !lease.lost) {
          const current = this.draftText()
          const owned = current === lease.written || (lease.written !== "" && lease.written.startsWith(current))
          if (owned) {
            try {
              this.getActions()?.setDraft?.("")
            } catch {
              /* the composer may be locked */
            }
          }
        }
        act.lease = null
      }

      // ------------------------------------------------------------- lifecycle

      async enable(sessionId) {
        this.sessionId = sessionId
        void this.refreshVoiceprint()
        if (this.act) return
        if (!this.speech) {
          await this.refresh()
          this.store.set({ message: { key: "unavailable" }, dialog: true })
          return
        }
        const catalog = await this.refresh()
        const provider = this.provider()
        if (!catalog || !provider) {
          this.store.set({ message: { key: "providerUnknown" }, dialog: true })
          return
        }
        if (provider.preparation.phase === "unprepared" || provider.preparation.phase === "failed" || provider.preparation.phase === "cancelled") {
          this.store.set({ message: { key: "needModel" }, dialog: true })
          return
        }
        // Pay the cold-start cost before the user starts talking, and say so:
        // "listening" while the model loads would be a lie.
        this.store.set({ phase: "starting", boundSession: sessionId, message: { key: "warming" }, liveText: "" })
        await this.warmRecognition()

        const token = (this.token += 1)
        const act = {
          token,
          phase: "starting",
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
        this.act = act
        this.store.set({ phase: "starting", message: null, boundSession: sessionId, dialog: false })

        const engine = new MicEngine({
          onLevel: (level) => this.onLevel(act, level),
          onSpeechStart: () => this.onSpeechStart(act),
          onUtterance: (frames, sampleRate, speechMs, cut) => this.onSegment(act, frames, sampleRate, cut),
        })
        this.engine = engine
        try {
          await engine.start(this.settings)
          if (this.token !== token || this.act !== act) {
            await engine.stop()
            return
          }
          act.phase = "listening"
          this.store.set({ phase: "listening" })
          this.startPreview(act)
        } catch (error) {
          if (this.token !== token || this.act !== act) {
            await engine.stop()
            return
          }
          this.engine = null
          this.act = null
          const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError"
          this.store.set({
            phase: "off",
            boundSession: null,
            level: 0,
            message: denied ? { key: "micDenied" } : { key: "micFailed", params: { message: error?.message || String(error) } },
            dialog: true,
          })
        }
      }

      async disable() {
        const act = this.act
        this.token += 1
        this.act = null
        if (act) {
          this.stopPreview(act)
          clearTimeout(act.bargeTimer)
          act.bargeTimer = null
          clearTimeout(act.holdTimer)
          act.holdTimer = null
          act.hold = null
          act.finalAbort?.abort()
          act.cancelPromise = null
          this.releaseLease(act, true)
        }
        this.stopPreparePoll()
        const engine = this.engine
        this.engine = null
        this.store.set({ phase: "off", level: 0, boundSession: null, liveText: "" })
        await engine?.stop()
      }

      onLevel(act, level) {
        if (this.act !== act || act.token !== this.token) return
        const now = Date.now()
        if (now - this.lastLevelAt < 80) return
        this.lastLevelAt = now
        const scaled = Math.max(0, Math.min(1, level * 6))
        if (Math.abs(scaled - this.store.getSnapshot().level) > 0.04) this.store.set({ level: scaled })
      }

      // ------------------------------------------------------------ barge-in

      onSpeechStart(act) {
        if (this.act !== act || act.phase !== "listening") return
        this.store.set({ liveText: "", message: null })
        if (act.lease === null) {
          // A new utterance, not a continuation after the duration cap.
          act.previewText = ""
          this.acquireLease(act)
        }
        // Every VAD segment starts a fresh frame array.
        act.previewFrameOffset = 0
        if (this.settings.interrupt !== "immediate") return
        // With a voiceprint, only the registered speaker may stop the turn; the
        // send path uses `steer` after verification instead of canceling here.
        if (this.voiceprintGating()) return
        clearTimeout(act.bargeTimer)
        act.bargeTimer = setTimeout(() => {
          act.bargeTimer = null
          if (this.act !== act || act.phase !== "listening") return
          if (!this.engine?.recentlyVoiced(400)) return
          const session = this.session()
          if (!session || !session.getSnapshot().running) return
          act.interrupted = true
          act.cancelPromise = session.cancel().then((result) => {
            this.flash(result.ok ? "interrupted" : "sendFailed", result.ok ? undefined : { message: result.error.message })
          })
        }, BARGE_IN_DELAY_MS)
      }

      // ------------------------------------------------------------- segments

      onSegment(act, frames, sampleRate, cut) {
        if (this.act !== act || act.token !== this.token) return
        if (cut) {
          // Duration cap reached: keep the audio and merge the continuation
          // instead of sending half a dictation.
          if (act.bufferSamples + frames.length < sampleRate * MAX_MERGED_SECONDS) {
            act.buffer.push(...frames)
            act.bufferSamples += frames.length
            // The VAD starts a fresh frame array for the continuation.
            act.previewFrameOffset = 0
            this.store.set({ message: { key: "stillListening" } })
            return
          }
        }
        const merged = act.bufferSamples > 0 ? [...act.buffer, ...frames] : frames
        act.buffer = []
        act.bufferSamples = 0
        const capped = trimFrames(merged, sampleRate * MAX_MERGED_SECONDS)
        // Hold the finished segment briefly. A short pause followed by more
        // speech must become one utterance; flushing immediately is what makes
        // the words around a pause inaccurate.
        if (act.hold === null) {
          act.hold = { frames: capped, sampleRate }
          act.holdSince = Date.now()
        } else {
          act.hold.frames.push(...capped)
        }
        clearTimeout(act.holdTimer)
        act.holdTimer = setTimeout(() => this.flushHold(act), PAUSE_GRACE_MS)
      }

      flushHold(act) {
        if (this.act !== act) return
        act.holdTimer = null
        const hold = act.hold
        if (hold === null) return
        // Speech (or a noise that may become speech) is still active: defer
        // instead of dropping the timer, otherwise a brief sound strands the
        // held utterance forever. A stuck VAD still flushes after 15 s.
        const overdue = Date.now() - (act.holdSince ?? 0) > 15000
        if (!overdue && (this.engine?.snapshot() !== null || this.engine?.recentlyVoiced(500))) {
          act.holdTimer = setTimeout(() => this.flushHold(act), 500)
          return
        }
        act.hold = null
        if (act.phase !== "listening") {
          act.pending = { frames: hold.frames, sampleRate: hold.sampleRate }
          return
        }
        void this.finalize(act, hold.frames, hold.sampleRate)
      }

      // -------------------------------------------------------------- preview

      restartPreview() {
        const act = this.act
        if (!act) return
        this.stopPreview(act)
        if (act.phase === "listening") this.startPreview(act)
      }

      startPreview(act) {
        if (act.previewTimer !== null) return
        if (this.settings.live === false && this.settings.mirror === false) return
        act.previewTimer = setInterval(() => void this.previewTick(act), 1400)
      }

      stopPreview(act) {
        if (act.previewTimer !== null) {
          clearInterval(act.previewTimer)
          act.previewTimer = null
        }
        act.previewAbort?.abort()
        act.previewAbort = null
        act.previewBusy = false
      }

      /**
       * Transcribe the next chunk of the open utterance and append it once.
       * Chunks are cut at a local energy minimum, so the preview grows
       * monotonically without re-transcribing text we already showed.
       */
      async previewTick(act) {
        if (this.act !== act || act.phase !== "listening" || act.previewBusy) return
        const settings = this.store.getSnapshot().settings
        if (settings.live === false && settings.mirror === false) return
        const snapshot = this.engine?.snapshot()
        if (!snapshot) return
        const rate = snapshot.sampleRate
        const frames = snapshot.frames
        const start = act.previewFrameOffset ?? 0
        if (start >= frames.length) return
        const chunk = chooseChunk(frames, start, rate, this.engine?.vad?.noise ?? 0.004)
        if (chunk === null) return
        act.previewBusy = true
        const token = act.token
        const abort = new AbortController()
        act.previewAbort = abort
        try {
          const pcm = await resampleTo16k(frames.slice(start, chunk.endIndex), rate)
          if (act.token !== token) return
          const result = await this.speech.transcribe(
            { audioBase64: toBase64(encodeWav(pcm, TARGET_RATE)), language: this.language() },
            abort.signal,
          )
          if (act.token !== token || act.phase !== "listening") return
          if (!result.ok) return
          const text = String(result.value?.text || "").trim()
          if (text === "") {
            act.previewFrameOffset = chunk.endIndex
            return
          }
          act.previewText = appendPreview(act.previewText, text)
          act.previewFrameOffset = chunk.endIndex
          if (settings.live !== false) this.store.set({ liveText: act.previewText })
          if (settings.mirror !== false) this.writeLease(act, act.previewText)
        } catch {
          // Leave the offset alone so the same chunk is retried next tick.
        } finally {
          if (act.token === token) {
            act.previewBusy = false
            if (act.previewAbort === abort) act.previewAbort = null
          }
        }
      }

      // --------------------------------------------------------------- final

      async finalize(act, frames, sampleRate) {
        if (this.act !== act) return
        act.phase = "transcribing"
        this.stopPreview(act)
        clearTimeout(act.bargeTimer)
        act.bargeTimer = null
        this.store.set({ phase: "transcribing", level: 0 })
        const token = act.token
        const wasInterrupted = act.interrupted
        act.interrupted = false
        let text = ""
        try {
          const pcm = await resampleTo16k(frames, sampleRate)
          if (act.token !== token) return
          if (pcm.length < TARGET_RATE * 0.15) throw Object.assign(new Error("too short"), { code: "short" })
          const wav = encodeWav(pcm, TARGET_RATE)
          if (wav.byteLength > MAX_AUDIO_BYTES) throw Object.assign(new Error("recording too large"), { code: "large" })
          const audioBase64 = toBase64(wav)
          const controller = new AbortController()
          act.finalAbort = controller
          const result = await this.speech.transcribe({ audioBase64, language: this.language() }, controller.signal)
          act.finalAbort = null
          if (act.token !== token) return
          if (!result.ok) throw new Error(result.error.message)
          text = String(result.value?.text || "").trim()
          if (text === "") {
            this.releaseLease(act, true)
            this.flash(wasInterrupted ? "emptyAfterInterrupt" : "empty", { seconds: (pcm.length / TARGET_RATE).toFixed(1) })
            return
          }
          if (this.isFiller(text)) {
            this.releaseLease(act, true)
            this.flash("ignored")
            return
          }
          const stripped = text.replace(/[\s\p{P}\p{S}]+/gu, "")
          if (stripped === "" || !/[\p{L}\p{N}]/u.test(stripped) || /^(.)\1{5,}$/u.test(stripped)) {
            this.releaseLease(act, true)
            this.flash("nonsense")
            return
          }
          if (!(await this.verifyVoiceprint(act, audioBase64))) {
            this.releaseLease(act, true)
            this.flash("vpRejected", { score: act.verdictScore })
            return
          }
          if (this.isStopCommand(text)) {
            this.releaseLease(act, true)
            const session = this.session()
            if (session) {
              const result = await session.cancel()
              if (!result.ok) this.flash("sendFailed", { message: result.error.message })
            }
            this.flash("stopped")
            return
          }
          const sent = await this.deliver(act, text)
          if (sent) {
            this.store.set({
              lastText: text,
              lastAudioSeconds: Number((pcm.length / TARGET_RATE).toFixed(1)),
              lastLanguage: this.language(),
              message: null,
            })
          }
        } catch (error) {
          if (act.token !== token) return
          this.flash(error?.code === "short" ? "empty" : "transcribeFailed", { message: error?.message || String(error) })
        } finally {
          if (act.token === token) {
            act.finalAbort = null
            act.phase = "listening"
            this.store.set({ phase: "listening", liveText: "" })
            this.startPreview(act)
            const pending = act.pending
            act.pending = null
            if (pending) {
              act.phase = "listening"
              void this.finalize(act, pending.frames, pending.sampleRate)
            }
          }
        }
      }

      async verifyVoiceprint(act, audioBase64) {
        const voiceprint = this.store.getSnapshot().voiceprint
        if (
          voiceprint === null ||
          voiceprint === undefined ||
          voiceprint.available === false ||
          voiceprint.enabled !== true ||
          !Array.isArray(voiceprint.speakers) ||
          voiceprint.speakers.length === 0
        ) {
          return true
        }
        try {
          const verdict = await voiceprintCall({ action: "verify", audioBase64 })
          this.applyVoiceprint(verdict)
          act.verdictScore = verdict.score
          return verdict.match !== false
        } catch (error) {
          // Fail open: a broken verifier must not swallow the user's speech.
          this.store.set({ voiceprintError: String(error?.message ?? error) })
          return true
        }
      }

      async deliver(act, text) {
        const session = this.session()
        if (!session) throw new Error("the target session is no longer open")
        if (act.cancelPromise) {
          try {
            await act.cancelPromise
          } catch {
            /* surfaced through the store */
          }
          act.cancelPromise = null
        }
        if (this.settings.send === "draft") {
          if (this.writeLease(act, text)) {
            this.store.set({ message: { key: "drafted" } })
            return true
          }
          const actions = this.getActions?.()
          if (!actions?.insertText) throw new Error("the composer is not editable right now")
          if (!actions.insertText(text, actions.captureInsertion())) {
            throw new Error("the draft changed before the transcript arrived")
          }
          this.store.set({ message: { key: "drafted" } })
          return true
        }
        // Auto-send: never post a transcript whose draft the user has since
        // edited or cleared; such an utterance belongs to them, not to us.
        if (this.leaseLost(act)) {
          this.releaseLease(act, false)
          this.flash("canceledByEdit")
          return false
        }
        this.releaseLease(act, true)
        const running = session.getSnapshot().running
        this.store.set({ phase: "sending" })
        const result = await session.prompt(
          [{ type: "text", text }],
          running ? "steer" : "queue",
          AbortSignal.timeout(20000),
        )
        if (!result.ok) throw new Error(result.error.message)
        return true
      }

      flash(key, params) {
        this.store.set({ message: { key, ...(params === undefined ? {} : { params }) } })
      }

      // ------------------------------------------------------------- helpers

      session() {
        if (!this.sessionId) return undefined
        try {
          const binding = this.ctx.sessions?.binding?.(this.sessionId)
          if (binding?.session) return binding.session
          return this.ctx.sessions?.manager?.get(this.sessionId)
        } catch {
          return undefined
        }
      }

      voiceprintGating() {
        const voiceprint = this.store.getSnapshot().voiceprint
        return (
          voiceprint !== null &&
          voiceprint !== undefined &&
          voiceprint.available !== false &&
          voiceprint.enabled === true &&
          Array.isArray(voiceprint.speakers) &&
          voiceprint.speakers.length > 0
        )
      }

      normalize(text) {
        return String(text ?? "").trim().replace(/[\s。，、！？!?.,~～…]+/g, "").toLowerCase()
      }

      isFiller(text) {
        const normalized = this.normalize(text)
        return normalized !== "" && FILLERS.has(normalized)
      }

      isStopCommand(text) {
        const normalized = this.normalize(text)
        return normalized !== "" && STOP_WORDS.has(normalized)
      }

      // ------------------------------------------------------------- voiceprint

      applyVoiceprint(payload) {
        this.voiceprint = payload
        this.store.set({ voiceprint: payload, voiceprintError: null })
      }

      async refreshVoiceprint() {
        try {
          this.applyVoiceprint(await voiceprintCall({ action: "state" }))
          return this.voiceprint
        } catch (error) {
          this.voiceprint = null
          this.store.set({ voiceprint: { available: false, error: String(error?.message ?? error) } })
          return null
        }
      }

      async sendVoiceprint(body) {
        try {
          this.applyVoiceprint(await voiceprintCall(body))
          return this.voiceprint
        } catch (error) {
          this.store.set({ voiceprintError: String(error?.message ?? error) })
          return null
        }
      }

      updateVoiceprint(patch) {
        if (patch.threshold !== undefined) {
          const current = this.store.getSnapshot().voiceprint
          if (current) this.store.set({ voiceprint: { ...current, threshold: patch.threshold } })
          clearTimeout(this.thresholdTimer)
          this.thresholdTimer = setTimeout(() => {
            void this.sendVoiceprint({ action: "settings", threshold: patch.threshold })
          }, 300)
          return
        }
        return this.sendVoiceprint({ action: "settings", ...patch })
      }

      async prepareVoiceprint() {
        await this.sendVoiceprint({ action: "prepare" })
        clearInterval(this.voiceprintPoll)
        this.voiceprintPoll = setInterval(async () => {
          const payload = await this.refreshVoiceprint()
          const phase = payload?.model?.phase
          if (payload === null || phase === "ready" || phase === "failed") {
            clearInterval(this.voiceprintPoll)
            this.voiceprintPoll = null
          }
        }, 900)
      }

      async removeVoiceprint(id) {
        await this.sendVoiceprint({ action: "remove", id })
      }

      async enrollVoiceprint(name, seconds, onProgress) {
        if (this.enrolling) throw new Error("a recording is already running")
        this.enrolling = true
        const wasActive = this.act !== null
        const sessionId = this.sessionId
        try {
          if (wasActive) await this.disable()
          const wav = await this.recordClip(seconds, onProgress)
          this.applyVoiceprint(await voiceprintCall({ action: "enroll", name, audioBase64: toBase64(wav) }))
        } finally {
          this.enrolling = false
          if (wasActive && sessionId) await this.enable(sessionId)
        }
      }

      async recordClip(seconds, onProgress) {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("getUserMedia is unavailable")
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        })
        const Ctor = window.AudioContext || window.webkitAudioContext
        const audio = new Ctor()
        const frames = []
        let source
        let highpass
        let processor
        let gain
        try {
          if (audio.state === "suspended") await audio.resume()
          source = audio.createMediaStreamSource(stream)
          highpass = audio.createBiquadFilter()
          highpass.type = "highpass"
          highpass.frequency.value = 85
          highpass.Q.value = 0.7
          processor = audio.createScriptProcessor(FRAME_SIZE, 1, 1)
          gain = audio.createGain()
          gain.gain.value = 0
          processor.onaudioprocess = (event) => {
            const input = event.inputBuffer.getChannelData(0)
            const frame = new Float32Array(input.length)
            frame.set(input)
            frames.push(frame)
          }
          source.connect(highpass)
          highpass.connect(processor)
          processor.connect(gain)
          gain.connect(audio.destination)
          const startedAt = Date.now()
          for (let remaining = seconds; remaining > 0; remaining -= 1) {
            onProgress?.(remaining)
            await new Promise((resolve) => setTimeout(resolve, 1000))
          }
          const elapsed = Date.now() - startedAt
          if (elapsed < seconds * 1000 - 150) {
            await new Promise((resolve) => setTimeout(resolve, seconds * 1000 - elapsed))
          }
          onProgress?.(0)
          if (frames.length === 0) throw new Error("no audio frames were captured")
          const captured = frames.reduce((total, frame) => total + frame.length, 0) / audio.sampleRate
          if (captured < 1) throw new Error("the recording is too short")
          processor.onaudioprocess = null
          return encodeWav(await resampleTo16k(frames, audio.sampleRate), TARGET_RATE)
        } finally {
          try {
            if (processor) processor.onaudioprocess = null
            source?.disconnect()
            highpass?.disconnect()
            processor?.disconnect()
            gain?.disconnect()
          } catch {
            /* nodes may already be gone */
          }
          for (const track of stream.getTracks()) track.stop()
          try {
            await audio.close()
          } catch {
            /* ignore */
          }
        }
      }

      // ------------------------------------------------------------- recognition

      async prepare() {
        if (!this.speech) return
        const provider = this.provider()
        if (!provider) return
        this.store.set({ preparing: true, message: null })
        try {
          const result = await this.speech.prepare(provider.id)
          if (!result.ok) {
            this.flash("modelFailed", { message: result.error.message })
            this.store.set({ preparing: false })
            return
          }
          this.watchPreparation()
        } catch (error) {
          this.store.set({ preparing: false })
          this.flash("modelFailed", { message: error?.message ?? String(error) })
        }
      }

      async cancelPrepare() {
        if (!this.speech) return
        const provider = this.provider()
        try {
          if (provider) await this.speech.cancelPreparation(provider.id)
        } catch {
          /* already stopped */
        }
        this.stopPreparePoll()
        this.store.set({ preparing: false })
      }

      watchPreparation() {
        this.stopPreparePoll()
        const tick = async () => {
          const catalog = await this.refresh()
          if (!catalog) return
          const phase = this.provider()?.preparation?.phase
          if (phase === "ready" || phase === "standby" || phase === "failed" || phase === "cancelled" || phase === "unprepared") {
            this.stopPreparePoll()
            this.store.set({ preparing: false })
            if (phase === "failed") this.flash("modelFailed", { message: this.provider()?.preparation?.message || "unknown" })
          }
        }
        this.prepPoll = setInterval(() => void tick(), 700)
        void tick()
      }

      stopPreparePoll() {
        if (this.prepPoll !== null) {
          clearInterval(this.prepPoll)
          this.prepPoll = null
        }
      }

      dispose() {
        void this.disable()
        this.stopPreparePoll()
        clearInterval(this.voiceprintPoll)
        this.voiceprintPoll = null
        clearTimeout(this.thresholdTimer)
      }
    }

    /**
     * Pick the next preview chunk: from `startIndex`, wait at least 3 s and at
     * most 9 s, cutting at the quietest 100 ms window so chunks end near a pause.
     * Longer chunks carry more context and are materially more accurate than
     * 2-second snippets; the final transcript still covers the whole utterance.
     * @returns `{ endIndex }` or null while the utterance is still too short.
     */
    function chooseChunk(frames, startIndex, rate, noise) {
      const minSamples = rate * 3
      const maxSamples = rate * 9
      let position = 0
      let best = null
      const recent = []
      for (let index = startIndex; index < frames.length; index += 1) {
        const frame = frames[index]
        recent.push(rmsOf(frame))
        if (recent.length > 5) recent.shift()
        position += frame.length
        if (position < minSamples) continue
        let average = 0
        for (const value of recent) average += value
        average /= recent.length
        const quiet = average <= Math.max(0.008, noise * 1.8)
        if (quiet) return { endIndex: index + 1, endInPause: true }
        if (best === null || average < best.rms) best = { endIndex: index + 1, rms: average }
        if (position >= maxSamples) break
      }
      return best === null ? null : { endIndex: best.endIndex, endInPause: false }
    }

    /** Join two preview chunks; only Latin words need a separating space. */
    function appendPreview(committed, chunk) {
      const text = String(chunk ?? "")
      if (text === "") return committed
      if (committed === "") return clampPreview(text)
      const needsSpace = /[A-Za-z0-9]$/.test(committed) && /^[A-Za-z0-9]/.test(text)
      return clampPreview(committed + (needsSpace ? " " : "") + text)
    }

    function clampPreview(text) {
      const limit = 20000
      return text.length > limit ? text.slice(-limit) : text
    }

    /** Keep a merged utterance inside the audio budget, dropping the oldest audio. */
    function trimFrames(frames, maxSamples) {
      let total = 0
      for (const frame of frames) total += frame.length
      if (total <= maxSamples) return frames
      let skip = total - maxSamples
      let start = 0
      while (start < frames.length && skip > 0) {
        skip -= frames[start].length
        start += 1
      }
      return frames.slice(start)
    }

    //#endregion

    //#region styles

    function injectStyles() {
      const style = document.createElement("style")
      style.dataset.dshVoiceBargeIn = ""
      style.textContent = `
.dsh-vbi-root{display:inline-flex;align-items:center;gap:2px;min-width:0}
.dsh-vbi-btn{display:inline-flex;align-items:center;justify-content:center;gap:3px;height:28px;min-width:28px;padding:0 4px;border:0;border-radius:8px;background:transparent;color:inherit;opacity:.72;cursor:pointer;font:inherit;line-height:1}
.dsh-vbi-btn:hover{background:color-mix(in srgb,currentColor 10%,transparent);opacity:1}
.dsh-vbi-btn:focus-visible{outline:2px solid #4d6bfe;outline-offset:1px}
.dsh-vbi-btn[aria-pressed="true"]{opacity:1;color:#4d6bfe}
.dsh-vbi-btn:disabled{opacity:.35;cursor:default}
.dsh-vbi-bars{display:inline-flex;align-items:flex-end;gap:2px;height:12px;width:18px}
.dsh-vbi-bars>i{display:block;width:2px;border-radius:1px;background:currentColor;transition:height 90ms linear;height:20%}
.dsh-vbi-dot{width:6px;height:6px;border-radius:50%;background:currentColor;animation:dsh-vbi-pulse 1.6s ease-in-out infinite}
@keyframes dsh-vbi-pulse{0%,100%{opacity:.35}50%{opacity:1}}
.dsh-vbi-dialog{border:0;border-radius:14px;padding:0;max-width:min(460px,92vw);width:460px;background:var(--dsh-surface,Canvas);color:inherit;box-shadow:0 18px 50px rgba(0,0,0,.35);position:fixed;right:20px;bottom:96px;margin:0;z-index:80}
.dsh-vbi-dialog[open]{display:block}
.dsh-vbi-dialog::backdrop{background:transparent}
.dsh-vbi-inner{display:flex;flex-direction:column;gap:14px;padding:18px 18px 16px;font-size:13px;line-height:1.5;max-height:82vh;overflow:auto}
.dsh-vbi-title{display:flex;align-items:center;justify-content:space-between;font-size:15px;font-weight:600;margin:0}
.dsh-vbi-status{padding:10px 12px;border-radius:10px;background:color-mix(in srgb,currentColor 6%,transparent);display:flex;flex-direction:column;gap:4px}
.dsh-vbi-status b{font-weight:600}
.dsh-vbi-muted{opacity:.68}
.dsh-vbi-warn{color:#c2410c}
.dsh-vbi-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dsh-vbi-label{font-weight:500}
.dsh-vbi-seg{display:inline-flex;border:1px solid color-mix(in srgb,currentColor 22%,transparent);border-radius:8px;overflow:hidden}
.dsh-vbi-seg>button{border:0;background:transparent;color:inherit;font:inherit;padding:5px 9px;cursor:pointer;opacity:.75}
.dsh-vbi-seg>button+button{border-left:1px solid color-mix(in srgb,currentColor 18%,transparent)}
.dsh-vbi-seg>button[aria-pressed="true"]{background:color-mix(in srgb,currentColor 14%,transparent);opacity:1;font-weight:600}
.dsh-vbi-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}
.dsh-vbi-action{font:inherit;border-radius:8px;border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:transparent;color:inherit;padding:6px 12px;cursor:pointer}
.dsh-vbi-action:hover{background:color-mix(in srgb,currentColor 8%,transparent)}
.dsh-vbi-action.is-primary{border-color:#4d6bfe;color:#4d6bfe;font-weight:600}
.dsh-vbi-progress{height:4px;border-radius:2px;background:color-mix(in srgb,currentColor 14%,transparent);overflow:hidden}
.dsh-vbi-progress>i{display:block;height:100%;background:#4d6bfe;transition:width 200ms ease}
.dsh-vbi-heard{border-left:2px solid color-mix(in srgb,currentColor 30%,transparent);padding-left:8px;opacity:.8;word-break:break-word}
.dsh-vbi-caption{display:flex;align-items:flex-start;gap:6px;max-width:100%;padding:5px 9px;border-radius:9px;background:color-mix(in srgb,currentColor 6%,transparent);font-size:12px;line-height:1.45;min-width:0}
.dsh-vbi-caption-dot{flex:none;width:6px;height:6px;margin-top:6px;border-radius:50%;background:#4d6bfe;animation:dsh-vbi-pulse 1.6s ease-in-out infinite}
.dsh-vbi-caption-label{flex:none;opacity:.6}
.dsh-vbi-caption-text{min-width:0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;word-break:break-word}
.dsh-vbi-vp{display:flex;flex-direction:column;gap:8px;padding-top:10px;border-top:1px solid color-mix(in srgb,currentColor 14%,transparent)}
.dsh-vbi-range{width:100%;accent-color:#4d6bfe}
.dsh-vbi-input{flex:1;min-width:0;font:inherit;color:inherit;background:transparent;border:1px solid color-mix(in srgb,currentColor 22%,transparent);border-radius:8px;padding:5px 9px}
.dsh-vbi-speakers{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.dsh-vbi-speakers li{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:3px 0}
.dsh-vbi-link{border:0;background:transparent;color:#4d6bfe;font:inherit;font-size:12px;cursor:pointer;padding:2px 4px}
.dsh-vbi-link:hover{text-decoration:underline}
.dsh-vbi-foot{font-size:12px;opacity:.6}
`
      document.head.appendChild(style)
      return () => style.remove()
    }

    //#endregion

    //#region UI

    function WaveIcon() {
      return h(
        "svg",
        { viewBox: "0 0 16 16", width: 15, height: 15, "aria-hidden": true, focusable: "false" },
        h("path", {
          d: "M2.5 6.5v3M5.25 4v8M8 2.5v11M10.75 4.5v7M13.5 6v4",
          stroke: "currentColor",
          strokeWidth: 1.5,
          strokeLinecap: "round",
          fill: "none",
        }),
      )
    }

    function LevelBars({ level }) {
      const bars = [0.45, 0.75, 1, 0.7, 0.4]
      return h(
        "span",
        { className: "dsh-vbi-bars", "aria-hidden": true },
        bars.map((weight, index) =>
          h("i", { key: index, style: { height: `${Math.max(14, Math.min(100, level * 130 * weight))}%` } }),
        ),
      )
    }

    function Segmented({ label, value, options, onChange }) {
      return h(
        "div",
        { className: "dsh-vbi-row" },
        h("span", { className: "dsh-vbi-label" }, label),
        h(
          "span",
          { className: "dsh-vbi-seg", role: "group", "aria-label": label },
          options.map((option) =>
            h(
              "button",
              {
                key: option.value,
                type: "button",
                "aria-pressed": value === option.value,
                onClick: () => onChange(option.value),
              },
              option.label,
            ),
          ),
        ),
      )
    }

    function formatBytes(value) {
      const bytes = Number(value) || 0
      if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
      if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
      if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
      return `${bytes} B`
    }

    function VoiceprintSettings({ controller, state, t }) {
      const [name, setName] = React.useState("")
      const [status, setStatus] = React.useState("")
      const [busy, setBusy] = React.useState(false)
      const [remaining, setRemaining] = React.useState(0)
      React.useEffect(() => {
        if (state.dialog) void controller.refreshVoiceprint()
      }, [state.dialog, controller])

      const vp = state.voiceprint
      if (vp === null || vp === undefined || vp.available === false) {
        return h(
          "div",
          { className: "dsh-vbi-vp" },
          h("div", { className: "dsh-vbi-label" }, t("voiceprint")),
          h("p", { className: "dsh-vbi-muted", style: { margin: 0 } }, t("vpUnavailable")),
        )
      }
      const speakers = Array.isArray(vp.speakers) ? vp.speakers : []

      const model = vp.model ?? {}
      const phase = model.phase
      const percent = phase === "downloading" && model.total
        ? Math.max(2, Math.min(100, (model.received / model.total) * 100))
        : null
      const ready = phase === "ready"
      const enroll = async () => {
        setBusy(true)
        setStatus("")
        setRemaining(6)
        const speaker = name.trim() || t("voiceprint")
        try {
          await controller.enrollVoiceprint(speaker, 6, (seconds) => {
            setRemaining(seconds)
            setStatus(seconds > 0 ? t("vpEnrolling", { seconds }) : "")
          })
          setStatus(t("vpEnrolled", { name: speaker }))
          setName("")
        } catch (error) {
          setStatus(t("vpError", { message: error?.message ?? String(error) }))
        } finally {
          setBusy(false)
          setRemaining(0)
        }
      }

      return h(
        "div",
        { className: "dsh-vbi-vp" },
        h(Segmented, {
          label: t("voiceprint"),
          value: vp.enabled ? "on" : "off",
          options: [
            { value: "on", label: t("vpOn") },
            { value: "off", label: t("vpOff") },
          ],
          onChange: (value) => void controller.updateVoiceprint({ enabled: value === "on" }),
        }),
        h("p", { className: "dsh-vbi-muted", style: { margin: "-8px 0 0" } }, t("vpHint")),

        ready
          ? h("p", { className: "dsh-vbi-muted", style: { margin: 0 } }, t("vpModelReady"))
          : phase === "downloading"
            ? h(
                "div",
                null,
                h("div", { className: "dsh-vbi-progress" }, h("i", { style: { width: `${percent || 2}%` } })),
                h(
                  "p",
                  { className: "dsh-vbi-muted", style: { margin: "4px 0 0" } },
                  t("vpDownloading", {
                    done: formatBytes(model.received ?? 0),
                    total: formatBytes(model.total ?? 0),
                  }),
                ),
              )
            : phase === "loading"
              ? h("p", { className: "dsh-vbi-muted", style: { margin: 0 } }, t("vpLoading"))
              : h(
                  "div",
                  { className: "dsh-vbi-actions" },
                  phase === "failed"
                    ? h("p", { className: "dsh-vbi-warn", style: { margin: 0, flex: 1 } }, t("vpFailed", { message: model.error ?? "" }))
                    : null,
                  h(
                    "button",
                    {
                      type: "button",
                      className: "dsh-vbi-action is-primary",
                      onClick: () => void controller.prepareVoiceprint(),
                    },
                    phase === "failed" ? t("vpRetry") : t("vpPrepare"),
                  ),
                ),

        h(
          "div",
          { className: "dsh-vbi-row" },
          h("span", { className: "dsh-vbi-label" }, t("vpThreshold")),
          h("span", { className: "dsh-vbi-muted" }, Number(vp.threshold ?? 0).toFixed(2)),
        ),
        h("input", {
          className: "dsh-vbi-range",
          type: "range",
          min: "0.4",
          max: "0.9",
          step: "0.01",
          value: Number(vp.threshold ?? 0.62),
          disabled: !ready,
          onChange: (event) => controller.updateVoiceprint({ threshold: Number(event.target.value) }),
        }),
        h("p", { className: "dsh-vbi-muted", style: { margin: "-8px 0 0" } }, t("vpThresholdHint")),

        h("div", { className: "dsh-vbi-label" }, t("vpSpeakers")),
        speakers.length === 0
          ? h("p", { className: "dsh-vbi-muted", style: { margin: 0 } }, t("vpNoSpeakers"))
          : h(
              "ul",
              { className: "dsh-vbi-speakers" },
              speakers.map((speaker) =>
                h(
                  "li",
                  { key: speaker.id },
                  h("span", null, speaker.name),
                  h(
                    "button",
                    {
                      type: "button",
                      className: "dsh-vbi-link",
                      onClick: () => void controller.removeVoiceprint(speaker.id),
                    },
                    t("vpRemove"),
                  ),
                ),
              ),
            ),

        h(
          "div",
          { className: "dsh-vbi-row" },
          h("input", {
            className: "dsh-vbi-input",
            type: "text",
            placeholder: t("vpName"),
            value: name,
            disabled: busy,
            onChange: (event) => setName(event.target.value),
          }),
          h(
            "button",
            {
              type: "button",
              className: "dsh-vbi-action",
              disabled: busy || !ready,
              onClick: () => void enroll(),
            },
            t("vpEnroll"),
          ),
        ),
        h("p", { className: "dsh-vbi-muted", style: { margin: "-8px 0 0" } }, t("vpEnrollHint")),
        busy && remaining > 0
          ? h(
              "div",
              { className: "dsh-vbi-progress" },
              h("i", { style: { width: `${Math.max(2, ((6 - remaining) / 6) * 100)}%` } }),
            )
          : null,
        status === "" ? null : h("p", { className: "dsh-vbi-muted", role: "status", style: { margin: 0 } }, status),
        state.voiceprintError
          ? h("p", { className: "dsh-vbi-warn", style: { margin: 0 } }, t("vpError", { message: state.voiceprintError }))
          : null,
      )
    }

    function Dialog({ controller, store, t, state, dialogRef }) {
      React.useEffect(() => {
        const node = dialogRef.current
        if (!node) return
        try {
          // Non-modal: a stuck panel must never make the composer inert.
          if (state.dialog && !node.open) node.show()
          if (!state.dialog && node.open) node.close()
        } catch {
          /* the element may have been detached during a session switch */
        }
      }, [state.dialog, dialogRef])

      const provider = state.catalog?.providers?.find(
        (item) => item.id === state.catalog?.selection?.providerId,
      )
      const preparation = provider?.preparation
      const phase = preparation?.phase
      const needsModel =
        phase === "unprepared" || phase === "failed" || phase === "cancelled"
      const downloading = typeof preparation?.completedBytes === "number"
      const progress = downloading && preparation.totalBytes
        ? Math.max(2, Math.min(100, (preparation.completedBytes / preparation.totalBytes) * 100))
        : null
      const message = state.message

      return h(
        "dialog",
        {
          ref: dialogRef,
          className: "dsh-vbi-dialog",
          "aria-labelledby": "dsh-vbi-dialog-title",
          onClose: () => store.set({ dialog: false }),
          onCancel: (event) => {
            event.preventDefault()
            store.set({ dialog: false })
          },
          onClick: (event) => {
            if (event.target === dialogRef.current) store.set({ dialog: false })
          },
        },
        h(
          "div",
          { className: "dsh-vbi-inner" },
          h(
            "h2",
            { className: "dsh-vbi-title", id: "dsh-vbi-dialog-title" },
            h("span", null, t("dialogTitle")),
            h(
              "button",
              {
                type: "button",
                className: "dsh-vbi-action",
                onClick: () => store.set({ dialog: false }),
              },
              t("close"),
            ),
          ),

          h(
            "div",
            { className: "dsh-vbi-status" },
            h(
              "b",
              null,
              state.speechReady
                ? phase === "ready" || phase === "standby" || phase === "waking"
                  ? t("modelReady")
                  : t("needModel")
                : t("unavailable"),
            ),
            !state.speechReady
              ? h("span", { className: "dsh-vbi-muted" }, t("unavailableHint"))
              : needsModel
                ? h("span", { className: "dsh-vbi-muted" }, t("needModelHint"))
                : null,
            typeof state.message?.key === "string" && message
              ? h(
                  "span",
                  { className: state.message.key === "modelFailed" ? "dsh-vbi-warn" : "dsh-vbi-muted" },
                  t(state.message.key, state.message.params),
                )
              : null,
          ),

          downloading
            ? h(
                "div",
                { className: "dsh-vbi-status" },
                h("b", null, t("preparing")),
                h("div", { className: "dsh-vbi-progress" }, h("i", { style: { width: `${progress || 2}%` } })),
                h(
                  "span",
                  { className: "dsh-vbi-muted" },
                  preparation.totalBytes
                    ? t("downloadProgress", {
                        done: formatBytes(preparation.completedBytes),
                        total: formatBytes(preparation.totalBytes),
                      })
                    : t("preparingStep", { step: t(STEP_KEYS[preparation.step] || "stepCheck") }),
                ),
              )
            : null,

          !state.speechReady
            ? h(
                "div",
                { className: "dsh-vbi-actions" },
                h(
                  "button",
                  {
                    type: "button",
                    className: "dsh-vbi-action is-primary",
                    onClick: () => {
                      void controller.openVoicePlugin()
                      store.set({ dialog: false })
                    },
                  },
                  t("openVoicePlugin"),
                ),
              )
            : needsModel || state.preparing
              ? h(
                  "div",
                  { className: "dsh-vbi-actions" },
                  state.preparing || downloading
                    ? h(
                        "button",
                        {
                          type: "button",
                          className: "dsh-vbi-action",
                          onClick: () => void controller.cancelPrepare(),
                        },
                        t("cancelPrepare"),
                      )
                    : h(
                        "button",
                        {
                          type: "button",
                          className: "dsh-vbi-action is-primary",
                          onClick: () => void controller.prepare(),
                        },
                        t("prepare"),
                      ),
                )
              : null,

          h(
            "div",
            null,
            h(Segmented, {
              label: t("interrupt"),
              value: state.settings.interrupt,
              options: [
                { value: "immediate", label: t("interruptImmediate") },
                { value: "after", label: t("interruptAfter") },
              ],
              onChange: (value) => controller.settingsPatch({ interrupt: value }),
            }),
            h(
              "p",
              { className: "dsh-vbi-muted", style: { margin: "4px 0 0" } },
              state.settings.interrupt === "immediate" ? t("interruptImmediateHint") : t("interruptAfterHint"),
            ),
          ),

          h(Segmented, {
            label: t("send"),
            value: state.settings.send,
            options: [
              { value: "auto", label: t("sendAuto") },
              { value: "draft", label: t("sendDraft") },
            ],
            onChange: (value) => controller.settingsPatch({ send: value }),
          }),
          h(
            "p",
            { className: "dsh-vbi-muted", style: { margin: "-8px 0 0" } },
            state.settings.send === "auto" ? t("sendAutoHint") : t("sendDraftHint"),
          ),

          h(Segmented, {
            label: t("sensitivity"),
            value: state.settings.sensitivity,
            options: [
              { value: "low", label: t("low") },
              { value: "medium", label: t("medium") },
              { value: "high", label: t("high") },
            ],
            onChange: (value) => controller.settingsPatch({ sensitivity: value }),
          }),

          h(Segmented, {
            label: t("silence"),
            value: state.settings.silenceMs,
            options: SILENCE_CHOICES.map((value) => ({ value, label: t("seconds", { value: value / 1000 }) })),
            onChange: (value) => controller.settingsPatch({ silenceMs: value }),
          }),
          h("p", { className: "dsh-vbi-muted", style: { margin: "-8px 0 0" } }, t("silenceHint")),

          h(
            "div",
            { className: "dsh-vbi-row" },
            h("span", { className: "dsh-vbi-label" }, t("language")),
            h(
              "select",
              {
                className: "dsh-vbi-input",
                value: state.settings.language ?? "auto",
                onChange: (event) => controller.settingsPatch({ language: event.target.value }),
              },
              LANGUAGES.map((language) => h("option", { key: language.value, value: language.value }, t(language.labelKey))),
            ),
          ),
          h("p", { className: "dsh-vbi-muted", style: { margin: "-8px 0 0" } }, t("languageHint")),

          h(Segmented, {
            label: t("mirror"),
            value: state.settings.mirror === false ? "off" : "on",
            options: [
              { value: "on", label: t("mirrorOn") },
              { value: "off", label: t("mirrorOff") },
            ],
            onChange: (value) => controller.settingsPatch({ mirror: value === "on" }),
          }),
          h("p", { className: "dsh-vbi-muted", style: { margin: "-8px 0 0" } }, t("mirrorHint")),

          h(Segmented, {
            label: t("live"),
            value: state.settings.live === false ? "off" : "on",
            options: [
              { value: "on", label: t("liveOn") },
              { value: "off", label: t("liveOff") },
            ],
            onChange: (value) => controller.settingsPatch({ live: value === "on" }),
          }),
          h("p", { className: "dsh-vbi-muted", style: { margin: "-8px 0 0" } }, t("liveHint")),

          h(VoiceprintSettings, { controller, state, t }),

          h(
            "div",
            null,
            h("div", { className: "dsh-vbi-label" }, t("lastHeard")),
            h(
              "div",
              { className: "dsh-vbi-heard" },
              state.lastText ? state.lastText : t("none"),
            ),
            state.lastAudioSeconds === null
              ? null
              : h(
                  "p",
                  { className: "dsh-vbi-muted", style: { margin: "4px 0 0" } },
                  `音频 ${state.lastAudioSeconds}s · 语言 ${state.lastLanguage ?? "auto"}`,
                ),
          ),

          h("div", { className: "dsh-vbi-foot" }, t("privacy")),
        ),
      )
    }

    function LiveCaption({ sessionId, store, t }) {
      const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
      if (state.boundSession !== sessionId) return null
      if (state.phase !== "starting" && state.phase !== "listening" && state.phase !== "transcribing" && state.phase !== "sending") {
        return null
      }
      const text = state.liveText
      const messageText = state.message?.key ? t(state.message.key, state.message.params) : ""
      const label =
        state.phase === "starting"
          ? t("captionStarting")
          : state.phase === "transcribing"
            ? t("captionTranscribing")
            : state.phase === "sending"
              ? t("sending")
              : t("captionListening")
      return h(
        "div",
        { className: "dsh-vbi-caption", "aria-live": "polite" },
        h("span", { className: "dsh-vbi-caption-dot", "aria-hidden": true }),
        text
          ? h("span", { className: "dsh-vbi-caption-label" }, t("captionPrefix"))
          : null,
        h("span", { className: "dsh-vbi-caption-text" }, text || messageText || label),
      )
    }

    /** Fallback when a runtime does not publish the `input` hook to this slot. */
    function useNoInput() {
      return ""
    }

    /**
     * Render guard: a bug in this plugin must never take the composer down with
     * it. Any render error degrades to "no widget" instead of a broken input bar.
     */
    class Guard extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }

      static getDerivedStateFromError() {
        return { failed: true }
      }

      componentDidCatch(error) {
        try {
          console.warn("[voice-barge-in] widget crashed", error)
        } catch {
          /* console may be unavailable */
        }
      }

      render() {
        return this.state.failed ? null : this.props.children
      }
    }

    function GuardedVoiceButton(props) {
      return h(Guard, null, h(VoiceButton, props))
    }

    function GuardedLiveCaption(props) {
      return h(Guard, null, h(LiveCaption, props))
    }

    function VoiceButton(props) {
      const { sessionId, inputActions, controller, store, t, useInput } = props
      const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
      const dialogRef = React.useRef(null)
      const useDraft = typeof useInput === "function" ? useInput : useNoInput
      const draft = useDraft((snapshot) => snapshot?.draft ?? "")
      const actionsRef = React.useRef(inputActions)
      actionsRef.current = inputActions
      const draftRef = React.useRef(draft)
      draftRef.current = draft

      const owns = state.boundSession === sessionId
      const active = owns && (state.phase === "starting" || state.phase === "listening" || state.phase === "transcribing" || state.phase === "sending")
      const busyElsewhere = state.boundSession !== null && state.boundSession !== sessionId

      React.useEffect(() => {
        controller.attachComposer(
          sessionId,
          () => actionsRef.current,
          () => draftRef.current,
        )
        return () => controller.releaseSession(sessionId)
      }, [controller, sessionId])

      const toggle = () => {
        if (busyElsewhere) {
          store.set({ dialog: true })
          return
        }
        if (active) void controller.disable()
        else void controller.enable(sessionId)
      }

      return h(
        "div",
        { className: "dsh-vbi-root" },
        h(
          "button",
          {
            type: "button",
            className: "dsh-vbi-btn",
            "aria-pressed": active,
            "aria-label": active ? t("toggleOff") : t("toggle"),
            title: `${active ? t("toggleOff") : t("toggle")}\n${t("hint")}`,
            onClick: toggle,
            onContextMenu: (event) => {
              event.preventDefault()
              store.set({ dialog: true })
            },
          },
          active && (state.phase === "listening" || state.phase === "starting")
            ? h(LevelBars, { level: state.level })
            : h(WaveIcon),
          active && state.phase !== "listening" && state.phase !== "starting"
            ? h("span", { className: "dsh-vbi-dot", "aria-hidden": true })
            : null,
        ),
        h(Dialog, { controller, store, t, state, dialogRef }),
      )
    }

    //#endregion

    //#region plugin

    const inject = ["remote", "slots", "locale", "sessions"]

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }))
      ctx.effect(() => injectStyles())

      const store = new Store({
        phase: "off",
        boundSession: null,
        speechReady: false,
        catalog: null,
        level: 0,
        lastText: "",
        lastAudioSeconds: null,
        lastLanguage: null,
        liveText: "",
        message: null,
        dialog: false,
        preparing: false,
        settings: readSettings(),
        voiceprint: null,
        voiceprintError: null,
      })

      const controller = new Controller(ctx, store)
      ctx.effect(() => () => controller.dispose())

      ctx.inject(["remote.speech"], (scope) => {
        controller.attachSpeech(scope.remote.speech)
        scope.effect(() => () => controller.detachSpeech())
      })

      ctx.slots.inject("conversation.input.right", () =>
        ctx.slots.register(
          {
            name: "conversation.input.right",
            id: "voice-barge-in",
            order: 5,
            locale: NS,
            inject: () => ({ controller, store }),
          },
          GuardedVoiceButton,
        ),
      )

      ctx.slots.inject("conversation.composer.dock", () =>
        ctx.slots.register(
          {
            name: "conversation.composer.dock",
            id: "voice-barge-in-caption",
            order: 0,
            locale: NS,
            inject: () => ({ controller, store }),
          },
          GuardedLiveCaption,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    exports.__test = { encodeWav, EnergyVad, resampleTo16k, readSettings, TARGET_RATE, Store, Controller }
    return module.exports
  },
})
