# Compatibility

## Verified matrix

| Harness version | Upstream tag | Status | Notes |
|---|---|---|---|
| `0.2.1-rc.2` | `dsh-v0.2.1-rc.2` | ✅ verified | desktop profile, Windows x64, local SenseVoice int8 |

## Upstream surface this plugin depends on

These are **experimental** and may change without notice:

- `dsh.client` contract: `platform: "web"`, `exports["./client"]`, loader entry as a package/bundle.
- Slots: `conversation.input.right` (list), `conversation.composer.dock` (list).
- Standard slot props: `sessionId`, `inputActions`, `useInput`, `t`.
- Session client: `ctx.sessions.binding(id).session`, `session.getSnapshot().running`,
  `session.prompt(content, "steer" | "queue")`, `session.cancel()`.
- Speech Remote namespace: `speech.catalog()`, `speech.prepare(id)`,
  `speech.cancelPreparation(id)`, `speech.transcribe({ audioBase64, language }, signal)`.
- Audio format: canonical 16 kHz mono PCM16 WAV, ≤ 4 MiB / 120 s.
- Voiceprint host route: `POST /voiceprint/api` (same-origin JSON), provided by
  this plugin's host half through `ctx.webServer.register({ kind: "prefix" })`.
  It requires a Harness restart after the host half changes; the browser half
  hot-reloads on its own.

## When bumping Harness

1. Check the upstream tag for the new version and read its
   `packages/experimental/client-ui-voice-input` and `speech-to-text` READMEs.
2. Confirm the slot names and the `InputActions` shape still exist.
3. Run `node test/smoke.mjs` (contract-level) and a manual mic pass.
4. Update this file and `docs/UPSTREAM.md`.

## Known gaps

- No streaming ASR: live text is re-transcription, ~1 s behind.
- Barge-in stops the agent turn; background jobs started by tools are not
  necessarily killed (depends on the tool).
- Single microphone binding per browser page; switching sessions stops capture.
