# dsh-voice-barge-in

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的**免提语音输入 + 语音打断 + 声纹识别**插件：说话即输入，实时写进输入框，说完自动发送；模型正在生成时，说话会打断当前回合并把你的新话发过去；开启声纹后只接受已注册说话人的声音。

> 社区二开项目（unofficial）。复用 Harness 的 MIT 许可语音服务接口与本地 SenseVoice 识别；采集、VAD、实时字幕、输入框镜像、打断策略和 UI 都是本仓库自己的实现。详见 [docs/UPSTREAM.md](docs/UPSTREAM.md) 与 [NOTICE.md](NOTICE.md)。

## 功能

- **免提常开**：点击一次开始持续聆听，能量 VAD 自动断句。
- **实时写入输入框**：说话过程中把识别文字不断写进 composer；输入框为空时才接管，开始打字会自动让出。
- **实时字幕**：输入框下方同步显示「听到：…」，可单独关闭。
- **语音打断（barge-in）**：
  - `立即打断`：检测到说话就 `cancel` 当前回合，识别完发送；
  - `说完插话`：识别完成后以 `steer` 中断并发送。
- **打断保护**：起音需持续约 0.7 秒才可能打断；开启声纹后只有通过校验的说话人能打断；`嗯/啊/哦/呃/哈…` 这类语气词既不发送也不打断；说「停 / 停止 / 暂停 / 取消」直接结束当前回合，不再发消息。
- **断句时长可调**：1.2 / 1.6 / 2.0 / 2.5 / 3.0 秒（默认 1.6 s）。
- **发送策略**：自动发送，或只填草稿由你确认。
- **声纹识别**：支持注册多个说话人；每句话发送前做说话人比对，不匹配就丢弃；相似度阈值可调（0.40–0.90）。只保存声纹向量，不保存录音。
- **杂音处理**：浏览器回声消除 / 降噪 / AGC + 85 Hz 高通 + 自适应噪声底 + **频谱平坦度判据**（挡风扇/空调/白噪声）+ 最短语音过滤；识别结果再做合法性检查，纯符号、乱码、重复字符直接丢弃。
- **拒绝原因可见**：输入框下方会显示「已忽略语气词 / 已忽略非语言声音 / 声纹不匹配（相似度 x）/ 已停止当前回合」，便于判断该调灵敏度还是阈值。
- **离线**：识别与声纹都在本机完成（首次分别下载约 240 MB 识别模型、27 MB 声纹模型），音频不离开本机。

## 依赖

需要启用官方实验性语音包，本插件通过它的 `speech` API 识别：

- `@deepseek-ai/dsh-experimental-voice-input-bundle`
  （`speech-to-text` + `speech-to-text-sensevoice` + `api-speech-to-text`）

它提供本地 SenseVoice 识别、模型下载/准备状态机和浏览器 `speech` Remote。本插件不复制其代码。

声纹识别使用 Harness 已打包的 `sherpa-onnx-node`（Apache-2.0）与 CAM++ 说话人嵌入模型（约 27 MB，运行时从 GitHub Releases 下载，不在仓库内分发）。

## 安装

### 方式一：profile 补丁（开发/本地）

在 profile 的 `cordis.patch.yml` 追加：

```yaml
- insert:
    - id: voice-barge-in
      name: 'file:///F:/path/to/dsh-voice-barge-in/lib/index.js'
```

并在 profile 的 `package.json` 的 `dsh.profile.bundles` 里加入官方语音包（若未启用）：

```json
"@deepseek-ai/dsh-experimental-voice-input-bundle"
```

重启 Harness（或让 HMR 重组合）后生效。

### 方式二：作为 Bundle 安装

本包声明了 `dsh.bundle.patch`，可被插件管理页识别为 bundle：

```bash
dsh plugin --profile <profile> add file:F:\\path\\to\\dsh-voice-barge-in
```

然后在插件页启用 `dsh-voice-barge-in` 与官方「语音输入」。

## 使用

1. 打开任意会话，点输入框右侧的波形按钮。
2. 首次使用按提示「下载并准备」模型（约 240 MB，仅一次）。
3. 允许麦克风后直接说话：文字会实时出现在输入框里，停顿 1.6 秒后自动发送。
4. 右键按钮打开设置；页面切到后台会自动关麦。

## 设置

| 设置 | 说明 | 默认 |
|---|---|---|
| 打断方式 | 立即打断 / 说完插话 | 立即打断 |
| 识别后 | 自动发送 / 只填草稿 | 自动发送 |
| 灵敏度 | VAD 噪声门限 | 中 |
| 静音断句 | 1.2–3.0 s | 1.6 s |
| 写入输入框 | 实时镜像到 composer | 开 |
| 实时字幕 | 下方字幕条 | 开 |
| 声纹 | 只接受已注册说话人 | 开（未注册时不生效） |
| 声纹阈值 | 相似度门限，越高越严格 | 0.62 |

## 架构

```
麦克风 → ScriptProcessor(原始 PCM) → 85Hz 高通 → 能量 VAD(自适应噪声底)
      → 16k 重采样 → WAV(PCM16) → speech.transcribe(整段)
      → 实时：每 ~1.1s 重识别已说部分 → 输入框/字幕
      → 声纹：POST /voiceprint/api verify → 余弦相似度 → 不匹配则丢弃
      → 结束：最终识别 → session.prompt(text, steer|queue)
```

关键点：本地识别器只接受整段录音，所以没有逐字流式；实时效果来自「反复重识别整段」，延迟约 1 秒。

## 声纹与隐私

- 注册：设置里点「录制 6 秒注册」，可注册多个说话人；
- 校验：最终识别后、发送前调用宿主侧比对，低于阈值就不发送并提示相似度；
- 存储：只把 192 维声纹向量写入 `~/.dsh/voiceprint/voiceprints.json`，不保存原始音频；
- 定位：声纹用于减少误触发，**不是安全认证**（录音回放、感冒、远场都会影响相似度）。

## 仓库结构

```
lib/index.js      宿主空壳（Loader 发现 dsh.client）
lib/client.js     浏览器 bundle：采集、VAD、实时、打断、UI
cordis.patch.yml  bundle 补丁
test/smoke.mjs    VM 加载 + WAV/VAD/注册自测
docs/             上游关系与兼容性说明
```

## 开发

```bash
node --check lib/client.js
node test/smoke.mjs
```

## 许可证

MIT，见 [LICENSE](LICENSE)。第三方组件与模型许可见 [NOTICE.md](NOTICE.md)。本项目与 DeepSeek 无隶属关系，未获官方背书。
