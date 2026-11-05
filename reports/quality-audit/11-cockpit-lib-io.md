# Slice 11 cockpit-lib-io — Quality Audit

Audited files (date 2026-11-05):
- `packages/cockpit/src/ui/lib/session.ts` (97 lines)
- `packages/cockpit/src/ui/lib/speech-recognition.ts` (181 lines)
- `packages/cockpit/src/ui/lib/sse-client.ts` (212 lines)

## R1

- `packages/cockpit/src/ui/lib/speech-recognition.ts:112` — `if (!res) continue;` — skips a missing result entry with bare `continue`; no state update, no dedicated error, silent drop of an unexpected shape.
- `packages/cockpit/src/ui/lib/speech-recognition.ts:114` — `if (!alt) continue;` — skips a missing alternative with bare `continue`; no state update, no dedicated error, silent drop.
- `packages/cockpit/src/ui/lib/speech-recognition.ts:142` — `} catch {` (empty, `// Fallthrough to regular error handling`) — empty catch branch; the retry-start failure adds no state of its own and relies on fallthrough code below rather than explicitly managing the branch.
- `packages/cockpit/src/ui/lib/speech-recognition.ts:175` — `} catch {` / `// Graceful catch for permission or state errors` — empty catch branch that only swallows; the `abort()` failure leaves no trace (no state change, no dedicated error).
- `packages/cockpit/src/ui/lib/sse-client.ts:136` — `if ((err as Error)?.name !== "AbortError") { console.warn(...); }` — branch that only logs without affecting control flow; missing `else` (AbortError vs non-AbortError leaves no explicit state distinction beyond the log).
- `packages/cockpit/src/ui/lib/sse-client.ts:164` — `for (const line of lines) { if (line.startsWith("event:")) ... else if (line.startsWith("data:")) ... }` — no final `else`; comment/heartbeat/empty/malformed lines are silently dropped with no explicit handling.
- `packages/cockpit/src/ui/lib/sse-client.ts:181` — `if (eventType === "snapshot") {...} else if (eventType === "agent") {...}` — missing final `else`; unknown `eventType` values are silently ignored with no dedicated error.
- `packages/cockpit/src/ui/lib/sse-client.ts:206` — `} catch {` / `// Ignored malformed JSON` — empty catch branch; malformed SSE payloads are swallowed with no state update and no dedicated error.

## R2

- `packages/cockpit/src/ui/lib/session.ts:6` — `reason = "SESSION_EXPIRED"` — default parameter silently substituting for an absent caller-provided reason instead of requiring an explicit named reason (silent-default clause).
- `packages/cockpit/src/ui/lib/speech-recognition.ts:69` — `start(options: SpeechRecognitionOptions = {})` — silent default `{}` hiding an absent options object instead of fail-fast with a named error.
- `packages/cockpit/src/ui/lib/speech-recognition.ts:83` — `windowWithSpeech.SpeechRecognition || windowWithSpeech.webkitSpeechRecognition` — fallback chain (`exists(p1) … elif exists(p2)` shape): speculative constructor cascade defaulting to the prefixed variant.
- `packages/cockpit/src/ui/lib/speech-recognition.ts:96` — `let targetLang = options.lang || "es-PE";` — `|| default` hiding absent `lang` state instead of fail-fast with a named error.
- `packages/cockpit/src/ui/lib/speech-recognition.ts:131` — `if (event.error === "language-not-supported" && ... targetLang === "es-PE") { ... targetLang = "es-ES"; ... }` — speculative locale retry/fallback cascade (`es-PE` → `es-ES`) instead of surfacing the named `language-not-supported` error.
- `packages/cockpit/src/ui/lib/speech-recognition.ts:139` — `try { recognition.start(); return; } catch { // Fallthrough ... }` — `catch { fallback }`: swallows the retry-start error and falls through to regular handling.
- `packages/cockpit/src/ui/lib/speech-recognition.ts:148` — `options.onError?.(event.error || "speech_recognition_error");` — `|| default` hiding an absent `event.error` instead of fail-fast with the actual error.
- `packages/cockpit/src/ui/lib/speech-recognition.ts:175` — `try { rec.abort(); } catch { // Graceful catch ... }` — `try/except` swallowing the `abort()` error.
- `packages/cockpit/src/ui/lib/sse-client.ts:129` — `buffer = parts.pop() ?? "";` — `?? default` hiding absent state (defensive default on `pop()`).
- `packages/cockpit/src/ui/lib/sse-client.ts:135` — `} catch (err: unknown) { if (... !== "AbortError") { console.warn(...); } }` — catch-all that swallows every non-abort stream failure and falls into silent reconnect instead of fail-fast with a named error.
- `packages/cockpit/src/ui/lib/sse-client.ts:140` — `finally { if (!this.authRevoked ...) { ...; this.scheduleReconnect(); } }` — speculative retry cascade: any cleared stream unconditionally reschedules a reconnect with backoff instead of surfacing a named connection error.
- `packages/cockpit/src/ui/lib/sse-client.ts:161` — `let eventType = "message";` — silent default event type for blocks lacking an `event:` line instead of fail-fast/ignoring explicitly with a named reason.
- `packages/cockpit/src/ui/lib/sse-client.ts:206` — `} catch { // Ignored malformed JSON }` — `try/except` swallowing JSON parse errors.

## R3

- `packages/cockpit/src/ui/lib/speech-recognition.ts:78` — `webkitSpeechRecognition?: new () => ISpeechRecognition;` — legacy vendor-prefixed API surface retained for old runtimes.
- `packages/cockpit/src/ui/lib/speech-recognition.ts:84` — `windowWithSpeech.webkitSpeechRecognition` — legacy-wrapper fallback path to the deprecated prefixed constructor (backwards-compat shim for old browsers).

## R4

- Within-slice repeat: `"TOKEN_EXPIRED"` — `packages/cockpit/src/ui/lib/session.ts:29`, `packages/cockpit/src/ui/lib/session.ts:33` — same operational string hardcoded twice; must live in a shared constant.
- Within-slice repeat: `"es-PE"` — `packages/cockpit/src/ui/lib/speech-recognition.ts:96`, `packages/cockpit/src/ui/lib/speech-recognition.ts:134` — same locale literal hardcoded twice; must live in a shared constant.
- Within-slice repeat: `10_000` — `packages/cockpit/src/ui/lib/sse-client.ts:151`, `packages/cockpit/src/ui/lib/sse-client.ts:152` — same cap/threshold literal hardcoded twice (backoff ceiling); must live in a shared constant.
- Cross-file literal: `"cockpit:session-expired"` — `packages/cockpit/src/ui/lib/session.ts:10`, `packages/cockpit/src/ui/lib/sse-client.ts:27` — same event-name literal in 2 files; must live in a shared constant.
- Cross-file-literal candidates for global synthesis (other file outside slice unknown; single-use within slice):
  - `"/api/stream"` — `packages/cockpit/src/ui/lib/sse-client.ts:95`
  - `"STREAM_UNAUTHORIZED"` — `packages/cockpit/src/ui/lib/sse-client.ts:106`
  - `"SESSION_EXPIRED"` — `packages/cockpit/src/ui/lib/session.ts:6`
  - `"es-ES"` — `packages/cockpit/src/ui/lib/speech-recognition.ts:137`
  - `"cockpit:connection-status"` — `packages/cockpit/src/ui/lib/sse-client.ts:72`
  - `"cockpit:snapshot"` — `packages/cockpit/src/ui/lib/sse-client.ts:189`
  - `"cockpit:agent-event"` — `packages/cockpit/src/ui/lib/sse-client.ts:203`
  - `"pims_cockpit_session"` — already extracted to `SESSION_STORAGE_KEY` (`packages/cockpit/src/ui/lib/session.ts:3`; uses at lines 48, 56, 79) — OK, listed only to aid global dedup.

## R5

No violations found.

## R6

- `packages/cockpit/src/ui/lib/sse-client.ts:95` — `await fetch("/api/stream", { headers: { Accept: "text/event-stream" ... } })` + manual `getReader()`/`TextDecoder` framing (`packages/cockpit/src/ui/lib/sse-client.ts:117-133`) + hand-rolled backoff reconnect (`packages/cockpit/src/ui/lib/sse-client.ts:147-157`, `this.backoffMs * 1.5` capped with `Math.min`) — custom hand-rolled SSE client with custom retry/backoff where the platform-native `EventSource` API already provides SSE framing plus automatic reconnection; name the native alternative: `EventSource`.

## Summary

| Rule | Count |
|------|-------|
| R1 | 8 |
| R2 | 13 |
| R3 | 2 |
| R4 | 4 (+8 candidates) |
| R5 | 0 |
| R6 | 1 |
| Total | 28 (+8 candidates) |
