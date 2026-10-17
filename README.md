# dsh-voice-barge-in

Hands-free voice input with barge-in and voiceprint for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Talk, see the transcript grow in the composer, and let it send when you stop.
While the agent is running, speaking interrupts the current turn and delivers
your new instruction. With a registered voiceprint, only your voice is accepted.

> Community plug-in (unofficial). It reuses the MIT-licensed Harness voice
> service and the locally bundled SenseVoice recognizer; capture, VAD, preview,
> draft handling, barge-in and the UI are implemented in this repository.
> See [docs/UPSTREAM.md](docs/UPSTREAM.md) and [NOTICE.md](NOTICE.md).

---

## Quick start（三步安装）

1. **安装 DeepSeek Harness 0.2.1+**（桌面版或 `dsh web`）。
2. **在插件页启用官方「语音输入」**——它提供本地识别服务和模型下载。
3. **安装本插件**：

   ```bash
   dsh plugin --profile web add github:yuanxing2/dsh-voice-barge-in
   ```

   或在插件页粘贴仓库地址 / 本地路径；也可手动在 profile 的
   `cordis.patch.yml` 追加：

   ```yaml
   - insert:
       - id: voice-barge-in
         name: 'file:///F:/path/to/dsh-voice-barge-in/lib/index.js'
   ```

重启 Harness，打开任意会话，点输入框右侧的波形按钮即可。首次使用会下载
识别模型（约 240 MB）和声纹模型（约 27 MB），都只下一次，之后完全离线。

## Features

- **免提常开**：点一次开始持续聆听，能量 VAD 自动断句。
- **实时写入输入框**：说话过程中文字持续写进 composer；输入框为空时才接管，
  你开始打字会自动让出。
- **实时字幕**：输入框下方同步显示当前识别内容，可单独关闭。
- **语音打断（barge-in）**：
  - `立即打断`：持续发声约 0.7 秒且当前回合在跑时，先 `cancel` 再发送；
  - `说完插话`：识别完成后以 `steer` 中断并发送。
- **打断保护**：开启声纹后只有通过校验的说话人能打断；`嗯/啊/哦/呃/哈…`
  不发送也不打断；说「停 / 停止 / 暂停 / 取消」直接结束当前回合。
- **停顿合并**：静音判定后再等 0.5 秒，期间继续说话会合并成同一条，
  避免一句话被停顿切成几条。
- **长句处理**：单段 60 秒上限，到达后不发送而是合并继续识别（总上限 100 秒）。
- **断句时长可调**：1.2 / 1.6 / 2.0 / 2.4 / 3.0 秒（默认 2.4 秒）。
- **发送策略**：自动发送，或只填草稿由你确认。
- **声纹识别**：可注册多个说话人；发送前比对，不匹配就丢弃；阈值 0.40–0.90 可调。
  只保存声纹向量，不保存录音。
- **杂音处理**：回声消除 / 降噪 / AGC + 85 Hz 高通 + 自适应噪声底 +
  频谱平坦度判据；识别结果再做合法性检查（纯符号、乱码、重复字符丢弃）。
- **输入框修改即作废**：语音结果返回前你改过或清空输入框，这条语音不再发送。
- **拒绝原因可见**：语气词、非语言声音、声纹不匹配、被编辑作废都会在下方提示。

## Requirements

- DeepSeek Harness **0.2.1+**（在 `0.2.1-rc.2` 上验证）。
- 官方实验性语音包 `@deepseek-ai/dsh-experimental-voice-input-bundle` 已启用。
- 首次使用需要网络：SenseVoice 模型来自 Hugging Face（支持 hf-mirror 回退），
  CAM++ 声纹模型来自 GitHub Releases。
- Windows x64 实测通过；macOS / Linux 使用同一套 `sherpa-onnx-node`，未实测。

## How it works

```
mic → ScriptProcessor (raw PCM) → 85 Hz high-pass → energy VAD (adaptive floor)
    → 16 kHz resample → WAV (PCM16) ──┬─ preview: 3–9 s chunks → composer / caption
                                      └─ final: whole utterance → ASR
    → voiceprint verify (cosine) → session.prompt(text, "steer" | "queue")
```

- 识别器只接受整段录音，所以没有逐字流式；预览是按停顿切块、每块识别一次后
  **追加**的，最终发送用整句识别。预览可能有一两个字的误差，以发送结果为准。
- 声纹在宿主侧用 Harness 已打包的 `sherpa-onnx-node` 计算，不上传音频。

## Settings

| 设置 | 说明 | 默认 |
|---|---|---|
| 打断方式 | 立即打断 / 说完插话 | 立即打断 |
| 识别后 | 自动发送 / 只填草稿 | 自动发送 |
| 灵敏度 | VAD 噪声门限 | 中 |
| 静音断句 | 1.2–3.0 秒 | 2.4 秒 |
| 识别语言 | 自动 / 中文 / English / 粤语 / 日本語 / 한국어 | 中文 |
| 写入输入框 | 实时写入 composer | 开 |
| 实时字幕 | 输入框下方字幕条 | 开 |
| 声纹 | 只接受已注册说话人 | 开（未注册不生效） |
| 声纹阈值 | 相似度门限，越高越严格 | 0.62 |

## Voiceprint & privacy

- 注册：设置里「录制 6 秒注册」，可注册多个说话人；
- 校验：最终识别后、发送前比对，低于阈值不发送并提示相似度；
- 存储：192 维声纹向量写入 `~/.dsh/voiceprint/voiceprints.json`，不保存原始音频；
- 定位：减少误触发，**不是安全认证**（录音回放、感冒、远场都会影响相似度）。

## Repository layout

```
lib/index.js       host half: voiceprint model, enrollment, /voiceprint/api
lib/client.js      browser bundle: capture, VAD, preview, barge-in, UI
cordis.patch.yml   bundle patch
test/smoke.mjs     bundle loading + WAV/VAD/slot wiring
test/host.mjs      host WAV validation and vector math
test/flow.mjs      controller state machine: send / merge / filler / edit-cancel
docs/              upstream relationship and compatibility notes
```

## Development

```bash
node --check lib/client.js
node test/smoke.mjs
node test/host.mjs
node test/flow.mjs
```

Real-mic verification needs the app: `pnpm`/build steps are not required because
`lib/client.js` is shipped prebuilt.

## License

MIT — see [LICENSE](LICENSE). Third-party components and models are listed in
[NOTICE.md](NOTICE.md). This project is not affiliated with or endorsed by DeepSeek.
