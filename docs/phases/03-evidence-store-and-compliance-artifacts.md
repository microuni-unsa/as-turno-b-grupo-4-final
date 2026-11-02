# Phase 3: Evidence Store, Notice Composer, and Compliance Artifacts

## Objective
Implement the PostgreSQL + Drizzle ORM encrypted evidence store with SHA-256 attachment hash integrity verification, GDPR Art 33 and Art 34 notice composers, exemption evaluation logic, and compliance bundle generation.

## Requirements & Scope
- **Encrypted Evidence Store (`packages/evidence/src/evidence-store.ts`)**:
  - PostgreSQL backing with Drizzle ORM (under dedicated `evidence` schema), encrypted at rest using AES-256-GCM (key from `EVIDENCE_KEY` env per §11.2).
  - Staging area for incident attachments prior to upload.
  - Storage of SHA-256 hashes, draft packs, reviewer approvals, active leases, deduplication indexes, and queued risk signals.
  - Automatic retention pruning based on `RETENTION_NOTICE_YEARS`.
- **Attachment Metadata, Hashing, and Pattern Extraction (`packages/evidence/src/forensic-patterns.ts`)**:
  - Attachment metadata validation through the shared `assertAttachmentMeta` rule (`@pims/types/attachments.ts`: `jpg,jpeg,png,tif,bmp,pdf,doc,docx,txt`, size ≤ 10 MB).
  - `forensic-patterns.ts` helpers: `sha256HexBytes`, `extractPii`, `extractIocs`, `decodeUtf8`; IOC and PII candidates are parser-validated (`net.isIP`, `tldts`, `libphonenumber-js` E.164, Spanish DNI/NIE checksum).
  - The VISION forensic scanner was removed in the downscale; `forensic_scan` is always null and no OCR/visual-analysis path runs.
  - SHA-256 computed pre-upload, verified post-upload by re-download + compare → mismatch raises `ATTACHMENT_HASH_MISMATCH`.
- **Notice Composer (`packages/notices/src/notice-composer.ts`)**:
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
    - Clear, plain-language body generator (≤25 words per sentence via `Intl.Segmenter`, items (b)–(d) only). Every numeric literal needs a per-token `NumericApproval`; there is no blanket subject-count flag.
- **Compliance Artifact Packaging (`packages/evidence/src/bundle-sealer.ts`)**:
  - Generation of Evidence Bundle manifests (§10.3).
  - Audit trail export format (§10.4).
  - Production of `BUNDLE_SEALED:<sha256>` marker upon closure.

## Deliverables
- `packages/evidence/src/evidence-store.ts`: Encrypted PostgreSQL + Drizzle repository.
- `packages/evidence/src/forensic-patterns.ts`: Attachment metadata rule, SHA-256 hashing, PII/IOC extraction, and UTF-8 decoding helpers (scanner removed).
- `packages/notices/src/notice-composer.ts`: Authority & subject notice builders.
- `packages/notices/src/exemption-engine.ts`: Decision table evaluator for Art 34(3) exemptions.
- `packages/evidence/src/bundle-sealer.ts`: Packaging and manifest generator.
- `tests/integration/evidence-store.test.ts`: Persistence and crypto verification tests with Testcontainers.
- `tests/unit/notice-composer.test.ts`: Notice composition and exemption evaluation tests (using `vi.mock`/`vi.spyOn`).

## Verification & Acceptance
- Art 33 pack produces valid schema with citations grounded in `gdpr-full`.
- Art 34(3)(a) exemption requires verifiable encryption evidence, rejecting ungrounded claims.
- Sealed bundle generates verifiable SHA-256 manifest and blocks modifications once sealed.
