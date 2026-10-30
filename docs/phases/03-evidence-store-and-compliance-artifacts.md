# Phase 3: Evidence Store, Notice Composer, and Compliance Artifacts

## Objective
Implement the local encrypted SQLite WAL evidence store, forensic attachment scanning, GDPR Art 33 and Art 34 notice composers, exemption evaluation logic, and compliance bundle generation.

## Requirements & Scope
- **Encrypted Evidence Store (`src/evidence/evidence-store.ts`)**:
  - Local SQLite with WAL mode, encrypted at rest using AES-256-GCM (key from `EVIDENCE_KEY` via `sops`).
  - Staging area for incident attachments prior to upload.
  - Storage of SHA-256 hashes, multimodal scan results, draft packs, reviewer approvals, active leases, deduplication indexes, and queued risk signals.
  - Automatic retention pruning based on `RETENTION_NOTICE_YEARS`.
- **Multimodal Forensic Inspection (`src/evidence/forensic-scanner.ts`)**:
  - Attachment allowlist validation (types `jpg,jpeg,png,tif,bmp,pdf,doc,docx,txt`, size ≤ 10 MB).
  - Integration with `VISION_MODEL` for visual and PDF forensic analysis (OCR, IOC extraction, visual PII detection, encryption verification for Art 34(3)(a)).
  - Computing SHA-256 pre-upload, post-upload re-download verification, and alerting on `ATTACHMENT_HASH_MISMATCH`.
- **Notice Composer (`src/notices/notice-composer.ts`)**:
  - GDPR Article 33 Authority Pack:
    - Exact JSON schema matching §10.1 (items (a)–(d), DPO contacts, consequences, measures, citations).
    - Phased disclosure support (`phased=true`) with tracked `unknown` fields.
    - Delay explanation generator if `submitted_at_utc > deadline_at_utc`.
  - GDPR Article 34 Data-Subject Notice:
    - High-risk triage gate evaluation.
    - Article 34(3) statutory exemption evaluation:
      - (a) Unintelligibility / Encryption (`encrypt_rest` + key safety).
      - (b) Subsequent mitigation ensuring high risk is no longer likely.
      - (c) Disproportionate effort (requiring public communication artifact).
    - Clear, plain-language body generator (≤25 words per sentence, items (b)–(d) only; subject counts strictly excluded).
- **Compliance Artifact Packaging (`src/evidence/bundle-sealer.ts`)**:
  - Generation of Evidence Bundle manifests (§10.3).
  - Audit trail export format (§10.4).
  - Production of `BUNDLE_SEALED:<sha256>` marker upon closure.

## Deliverables
- `src/evidence/evidence-store.ts`: Encrypted SQLite WAL repository.
- `src/evidence/forensic-scanner.ts`: Attachment processor and hashing verifier.
- `src/notices/notice-composer.ts`: Authority & subject notice builders.
- `src/notices/exemption-engine.ts`: Decision table evaluator for Art 34(3) exemptions.
- `src/evidence/bundle-sealer.ts`: Packaging and manifest generator.
- `tests/integration/evidence-store.test.ts`: Persistence and crypto verification tests.
- `tests/unit/notice-composer.test.ts`: Notice composition and exemption evaluation tests (using `vi.mock`/`vi.spyOn`).

## Verification & Acceptance
- Art 33 pack produces valid schema with citations grounded in `gdpr-full`.
- Art 34(3)(a) exemption requires verifiable encryption evidence, rejecting ungrounded claims.
- Sealed bundle generates verifiable SHA-256 manifest and blocks modifications once sealed.
