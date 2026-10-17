# Third-party notices

This project is a community derivative ("二开") for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It does not
redistribute the Harness application or its model weights.

## DeepSeek Harness

- Packages: `@deepseek-ai/dsh-*` (runtime plugin API, conversation slots,
  session controller) and the experimental voice input bundle
  (`speech-to-text`, `speech-to-text-sensevoice`, `api-speech-to-text`,
  `client-ui-voice-input`).
- License: MIT, Copyright (c) 2026 DeepSeek.
- Upstream: https://github.com/deepseek-ai/deepseek-harness
- Pinned version at development time: `0.2.1-rc.2`
  (tag `dsh-v0.2.1-rc.2`).

We only call their public plugin interfaces (`ctx.slots`, `ctx.remote.speech`,
`session.prompt` / `session.cancel`). No upstream source is copied into this
repository except the small `cordis.patch.yml` composition pattern, which is
MIT-licensed as well.

## sherpa-onnx

- Used indirectly through the official SenseVoice provider; not bundled here.
- License: Apache-2.0.
- Upstream: https://github.com/k2-fsa/sherpa-onnx

## SenseVoiceSmall model

- Downloaded at runtime from Hugging Face by the official provider; never
  committed to this repository.
- Model: `csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17`.
- License: Apache-2.0 (see the model card for the authoritative text).

## CAM++ speaker embedding model (voiceprint)

- Downloaded at runtime by this plugin from the sherpa-onnx GitHub releases;
  never committed to this repository.
- Model: `3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx` (28,281,138 bytes).
- Upstream: https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-recongition-models
- License: Apache-2.0 (3D-Speaker / CAM++).

## ONNX Runtime

- Distributed by the official provider as part of `sherpa-onnx-node`.
- License: MIT.
- Upstream: https://github.com/microsoft/onnxruntime

## Trademarks

"DeepSeek" and "DeepSeek Harness" are trademarks of their owners. This project
is unofficial and not endorsed by DeepSeek.
