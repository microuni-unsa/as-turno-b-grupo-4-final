# Phase 5: Voice Gateway & Streaming Intake Subsystem

## Objective
Implement the streaming Voice Gateway handling audio intake, Speech-to-Text (STT), Text-to-Speech (TTS), Voice Activity Detection (VAD) barge-in, acoustic anti-spoofing, paralinguistic urgency scoring, and dual-pass PII redaction.

## Requirements & Scope
- **Streaming Audio Ingestion & STT (`src/voice/stt-service.ts`)**:
  - Streaming audio processing supporting primary locale `es-PE` and fallback `en`.
  - Confidence scoring: mean confidence < `VOICE_MIN_CONFIDENCE` raises `VOICE_LOW_CONFIDENCE`.
  - Integration with containerized Whisper service (running on port 9000) and pluggable STT providers.
- **Acoustic Anti-Spoofing & Prosody Analysis (`src/voice/acoustic-analyzer.ts`)**:
  - Paralinguistic stress/urgency scoring to calibrate initial incident severity.
  - Spoof detection: synthetic voice detection score ≥ `VOICE_SPOOF_THRESHOLD` flags incident for mandatory reviewer verification (`VOICE_SPOOF_SUSPECTED`).
- **Dual-Pass PII Redaction Pipeline (`src/voice/redaction.ts`)**:
  - Pass 1: Named Entity Recognition (NER) for person names, organizations, locations.
  - Pass 2: High-precision regular expressions for DNI/CE document numbers, phone numbers, email addresses, credit cards.
  - Strict guard: TTS synthesis blocks if any unredacted PII patterns are detected (`TTS_PII_LEAK_BLOCKED`). Raw audio and unredacted speech never enter prompts or log files.
- **Interactive Voice Readback Confirmation (`src/voice/voice-intake-flow.ts`)**:
  - Conversational intake state machine extracting facts into the §9.1 schema.
  - Readback confirmation loop before incident creation: synthesized summary read to caller; confirmation captured via STT.

## Deliverables
- `src/voice/stt-service.ts`: STT provider gateway.
- `src/voice/tts-service.ts`: TTS synthesis engine with PII leak prevention.
- `src/voice/acoustic-analyzer.ts`: Anti-spoofing and prosody urgency scoring.
- `src/voice/redaction.ts`: Dual-pass NER + regex redaction engine.
- `src/voice/voice-intake-flow.ts`: Voice intake dialog manager.
- `tests/integration/voice-gateway.test.ts`: Integration tests connecting to the local Whisper service.
- `tests/unit/redaction.test.ts`: Rigorous unit tests for PII redaction and leak prevention (using `vi.mock`/`vi.spyOn`).

## Verification & Acceptance
- Synthetic audio with DNI and phone numbers has all PII redacted prior to prompt ingestion.
- Attempted synthesis of text containing raw PII throws `TTS_PII_LEAK_BLOCKED`.
- Voice intake correctly populates `core_incident` fields with Spanish readback confirmation.
