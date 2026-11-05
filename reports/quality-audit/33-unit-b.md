# Slice 33 unit-b — Quality Audit

Audited files (date 2026-11-05):
- `tests/unit/config.test.ts` — 452 lines
- `tests/unit/crypto.test.ts` — 166 lines
- `tests/unit/exemption-engine.test.ts` — 263 lines
- `tests/unit/form-draft-and-speech.test.ts` — 500 lines

## R1

- `tests/unit/form-draft-and-speech.test.ts:56` — `if (!this.listeners[type]) this.listeners[type] = [];` — `if` without `else`; no-action path leaves listener-map state implicit (test context).
- `tests/unit/form-draft-and-speech.test.ts:71` — `closest(_selector: string) { return this.parentElement ?? this; }` — selector argument ignored (unused `_selector`); branch over selector value never handled, state (which ancestor matches) left implicit (test context).
- `tests/unit/form-draft-and-speech.test.ts:100` — `for (const part of parts) { if (...) return true; ... }` + `tests/unit/form-draft-and-speech.test.ts:119` — `return false;` — comma-separated selector parts evaluated in a loop with per-part `if/continue` and no explicit per-part else; non-matching parts fall through silently to the next iteration / final `false` (test context).
- `tests/unit/form-draft-and-speech.test.ts:110` — `if (matchName && this.name !== matchName[1]) continue;` — missing `else`; mismatch path is a silent `continue` with no state update or error (test context).
- `tests/unit/form-draft-and-speech.test.ts:111` — `if (matchVal && this.value !== matchVal[1]) continue;` — same: silent `continue`, no explicit state handling (test context).
- `tests/unit/form-draft-and-speech.test.ts:115-116` — `if (matchName && this.name === matchName[1]) return true;` — missing `else`; fall-through to `return false` leaves which clause failed implicit (test context).
- `tests/unit/form-draft-and-speech.test.ts:156` — `if (env.window) { delete ...; delete ...; }` — missing `else`; `env.window === undefined` path is a silent noop (test context).
- `tests/unit/form-draft-and-speech.test.ts:162` — `if (env.window) { env.window.SpeechRecognition = class {}; }` — missing `else`; undefined-window path silently does nothing (test context).
- `tests/unit/form-draft-and-speech.test.ts:200` — `if (env.window) { env.window.SpeechRecognition = MockSpeechRecognition; }` — missing `else`, silent noop path (test context).
- `tests/unit/form-draft-and-speech.test.ts:270` — `if (env.window) { env.window.SpeechRecognition = MockSpeechRecognition; }` — missing `else`, silent noop path (test context).
- `tests/unit/form-draft-and-speech.test.ts:423` — `if (env.window) { env.window.dispatchEvent = ...; }` — missing `else`; when window is undefined `eventFired` stays `false` and the subsequent `expect(eventFired).toBe(true)` is the only signal, state left implicit in the branch itself (test context).
- `tests/unit/form-draft-and-speech.test.ts:425` — `if ((ev as { type: string }).type === "cockpit:form-updated") { eventFired = true; }` — missing `else`; non-matching event types silently ignored without state handling (test context).

## R2

- `tests/unit/crypto.test.ts:95` — `corrupted[ciphertextOffset] = (corrupted[ciphertextOffset] ?? 0) ^ 0xff;` — `?? 0` default hides absent (out-of-bounds `undefined`) byte instead of fail-fast with a named error (test context).
- `tests/unit/crypto.test.ts:111` — `corrupted[tagOffset] = (corrupted[tagOffset] ?? 0) ^ 0x01;` — same `?? 0` silent default (test context).
- `tests/unit/crypto.test.ts:127` — `corrupted[ivOffset] = (corrupted[ivOffset] ?? 0) ^ 0x5a;` — same `?? 0` silent default (test context).
- `tests/unit/form-draft-and-speech.test.ts:24` — `this.bubbles = options?.bubbles ?? false;` — `?? false` defaults absent option instead of fail-fast / explicit required-option error (test context).
- `tests/unit/form-draft-and-speech.test.ts:57` — `this.listeners[type]?.push(fn);` — optional-chaining call silently no-ops if the preceding `if` initialization were skipped; hides absent state instead of fail-fast (test context).
- `tests/unit/form-draft-and-speech.test.ts:61` — `const list = this.listeners[ev.type] || [];` — `|| []` silent default hides absent listener list (test context).
- `tests/unit/form-draft-and-speech.test.ts:72` — `return this.parentElement ?? this;` — `?? this` fallback hides absent parent instead of named error (test context).
- `tests/unit/form-draft-and-speech.test.ts:93` — `return list[0] ?? null;` — `?? null` default for absent query result instead of explicit empty-result handling (test context).
- `tests/unit/form-draft-and-speech.test.ts:304` — `(key: string) => mockStorage[key] ?? null;` — `?? null` hides absent storage key instead of fail-fast (test context).

## R3

No violations found.

## R4

Within-slice repeats (same literal hardcoded 2+ times in these files):
- `tests/unit/config.test.ts:11,13,15,17,271` — `"https://api.mistral.ai"` — operational URL repeated 5×; should be a shared constant.
- `tests/unit/config.test.ts:11,13,15,17,19,271` — `"fallback:none"` model-spec suffix repeated 6× (test context).
- `tests/unit/config.test.ts:20,271` (and `21` dummy key reuse) — `"MISTRAL_API_KEY"` / `"dummy-mistral-key"` / `"COHERE_API_KEY"` credential names/values repeated between `baseValidEnv` and `vi.stubEnv` block (test context).
- `tests/unit/config.test.ts:9,42-44` — `"postgres://pims:pims@localhost:5432/pims_evidence"` repeated (test context).
- `tests/unit/crypto.test.ts:61,82,94` — magic length `28` (12 IV + 16 tag) hardcoded in `toBeGreaterThan(28)`, `toBe(28)`, `ciphertextOffset = 28` (test context).
- `tests/unit/crypto.test.ts:101,117` — `"Decryption failed or authentication tag mismatch"` repeated 2× (test context).
- `tests/unit/crypto.test.ts:157-162` — `"Encrypted payload too short: minimum 28 bytes required (12 IV + 16 Tag)"` asserted inside a loop over 4 buffers; message literal + `28`/`12`/`16` magic numbers (test context).
- `tests/unit/exemption-engine.test.ts:40,48,54` — `"AEPD-ORDER-2026-77"` repeated 3× (test context).
- `tests/unit/exemption-engine.test.ts:12,21` (+ `encryptionProof.incident_code`) — `"INC-2026-001"` repeated (test context).
- `tests/unit/exemption-engine.test.ts:9,208` — `"2026-10-30T12:00:00.000Z"` via `verifiedAtUtc` const is shared (OK), but `"file:public-notice-2026-10-30.pdf"` at `:208,221` repeated 2× (test context).
- `tests/unit/form-draft-and-speech.test.ts:210,225,275,278` — `"es-PE"` repeated 4× (test context).
- `tests/unit/form-draft-and-speech.test.ts:351,393` — `"incident-form"` repeated 2× (test context).
- `tests/unit/form-draft-and-speech.test.ts:355,367,375` — `"INPUT"` tag-name literal repeated 3× (test context).

Cross-file-literal candidates for global synthesis (literal + file:line):
- `"https://api.mistral.ai"` — `tests/unit/config.test.ts:11,13,15,17,271`
- `"https://api.cohere.com"` — `tests/unit/config.test.ts:19`
- `"https://unsa.27k.pe"` — `tests/unit/config.test.ts:27`
- `"http://127.0.0.1:3001"` — `tests/unit/config.test.ts:49`
- `"presidio-analyzer:2.2.x-es"` — `tests/unit/config.test.ts:50`
- `"es_core_news_md"` — `tests/unit/config.test.ts:51`
- `"corpus"` — `tests/unit/config.test.ts:48`
- `"postgres://pims:pims@localhost:5432/pims_evidence"` — `tests/unit/config.test.ts:9,42`
- `"fallback:none"` — `tests/unit/config.test.ts:11,13,15,17,19,271`
- `28` / `12` / `16` (GCM IV/tag lengths) — `tests/unit/crypto.test.ts:61,72,82,94,110,126,161`
- `"Decryption failed or authentication tag mismatch"` — `tests/unit/crypto.test.ts:101,117`
- `"AEPD-ORDER-2026-77"` — `tests/unit/exemption-engine.test.ts:40,48,54`
- `"INC-2026-001"` — `tests/unit/exemption-engine.test.ts:12,21`
- `"es-PE"` / `"es-ES"` — `tests/unit/form-draft-and-speech.test.ts:210,225,244,275,278,282`
- `"cockpit:form-updated"` — `tests/unit/form-draft-and-speech.test.ts:425`
- `"STORAGE_KEY_FORM_DRAFT"` value (via imported `STORAGE_KEY_FORM_DRAFT`, used at `tests/unit/form-draft-and-speech.test.ts:340`) — candidate shared constant already imported (OK, note for synthesis).

## R5

No violations found.

## R6

- `tests/unit/form-draft-and-speech.test.ts:18-27` — hand-rolled `MockEvent` class — native/ecosystem alternative: `CustomEvent`/`Event` from `jsdom` or `happy-dom` via vitest browser environment (test context).
- `tests/unit/form-draft-and-speech.test.ts:31-121` — hand-rolled `MockElement` DOM (`addEventListener`/`dispatchEvent`/`appendChild`/`querySelectorAll`/`querySelector`/`matches`/`classList`) — ecosystem alternative: `jsdom`/`happy-dom` + `@testing-library/dom` instead of a custom DOM engine (test context).
- `tests/unit/form-draft-and-speech.test.ts:75-89` — hand-rolled recursive `walk` tree traversal for `querySelectorAll` — native alternative: DOM `Element.querySelectorAll` (via jsdom/happy-dom) (test context).
- `tests/unit/form-draft-and-speech.test.ts:98-120` — hand-rolled CSS selector parser (`split(",")`, `startsWith`, `RegExp match` on `name="..."/value="..."`) — native alternative: built-in selector engine (`querySelectorAll`) (test context).
- `tests/unit/form-draft-and-speech.test.ts:39-50` — hand-rolled `classList` (`Set` + `add`/`remove`/`contains`) — native alternative: `DOMTokenList` from a real DOM implementation (test context).
- `tests/unit/form-draft-and-speech.test.ts:60-64` — hand-rolled event dispatch loop — native alternative: `EventTarget.dispatchEvent` event propagation (test context).
- `tests/unit/config.test.ts:58-63,65-70` (pattern repeated ~20× through `:419`) — hand-rolled `try { loadConfig(...); expect.unreachable(...) } catch (err) { expect(code).toBe(...) }` assertion scaffolding — ecosystem alternative: vitest `expect(() => ...).toThrowError(expect.objectContaining({ code }))` / inline-snapshot error assertion (test context).
- `tests/unit/exemption-engine.test.ts:105-115,181-200` — hand-rolled `try { evaluate(...); expect.unreachable(...) } catch` loops — ecosystem alternative: vitest `expect(...).toThrowError(ExemptionUngroundedError)` / `toThrowErrorMatchingSnapshot` (test context).
- `tests/unit/crypto.test.ts:75` — hand-rolled `Buffer.compare(decrypted, binaryPayload)` + `toBe(0)` — native alternative: `Buffer.prototype.equals` (`expect(decrypted.equals(binaryPayload)).toBe(true)` / `expect(decrypted).toEqual(binaryPayload)`) (test context).

## Summary

| Rule | Count |
|------|-------|
| R1 | 12 |
| R2 | 9 |
| R3 | 0 |
| R4 | 13 within-slice groups (+16 cross-file candidates) |
| R5 | 0 |
| R6 | 9 |
| Total | 43 (+16 cross-file candidates) |
