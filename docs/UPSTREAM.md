# Upstream relationship (二开说明)

This repository is a **community derivative** of the DeepSeek Harness voice
input stack. It is not a fork of the whole Harness; it is a plugin bundle that
builds on the published plugin interfaces and reuses the official local
speech-to-text service.

## What we reuse (dependency, not copy)

| Upstream piece | Role | License |
|---|---|---|
| `@deepseek-ai/dsh-experimental-voice-input-bundle` | host-side speech service + SenseVoice provider + `speech` API Remote | MIT |
| `@deepseek-ai/dsh-client-ui-conversation` | composer slots, `InputActions`, session hooks | MIT |
| `@deepseek-ai/dsh-api-session-controller` | `session.prompt` / `session.cancel`, running state | MIT |
| `@deepseek-ai/cordis` | plugin runtime | MIT |
| `sherpa-onnx-node` (bundled with Harness) | speaker embedding extraction for voiceprint | Apache-2.0 |

Voiceprint reuses the `sherpa-onnx-node` runtime that DeepSeek Harness already
ships, so no extra native dependency is installed. The CAM++ embedding model is
downloaded on first use from the sherpa-onnx GitHub releases (27 MB) and cached
under the profile data directory; it is not committed here.

## What is ours

- `lib/client.js` — continuous capture, energy VAD, resampling/WAV encoding,
  live re-transcription, draft mirroring, barge-in policy, UI, settings.
- `lib/index.js` — host-side voiceprint service: model download, CAM++
  embedding, multi-speaker enrollment, cosine threshold, `/voiceprint/api`.
- `lib/index.js`, `package.json`, `cordis.patch.yml` — bundle/plugin packaging.
- Noise handling: 85 Hz high-pass plus the browser's echo cancellation /
  noise suppression / AGC constraints.

## Why not fork the client UI

The official client UI (`client-ui-voice-input`) is a click-to-record control
that inserts a transcript into the draft. Our interaction model (always-on VAD,
immediate barge-in, live captions, draft mirroring) differs enough that porting
it into their component tree would fork ~3 000 lines of UI code and make
upstream updates expensive, without adding user-visible value.

If someone wants the deeper fork, the recommended shape is:

1. vendor `packages/experimental/client-ui-voice-input/src` at tag
   `dsh-v0.2.1-rc.2`;
2. keep the official host bundle for recognition;
3. replace their `VoiceInput` component with a hands-free controller;
4. keep the MIT notice and record the upstream commit in `NOTICE.md`.

## Version pinning

Developed and verified against Harness `0.2.1-rc.2`
(commit `332895e` in the shipped build, upstream tag `dsh-v0.2.1-rc.2`).
The `speech` Remote and the conversation slot names are experimental and may
change between Harness releases; check
`docs/COMPATIBILITY.md` before bumping.
