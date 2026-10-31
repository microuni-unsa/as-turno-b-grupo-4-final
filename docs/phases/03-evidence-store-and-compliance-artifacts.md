# Phase 3: Evidence Store, Notice Composer, and Compliance Artifacts

## Objective
Implement the PostgreSQL + Drizzle ORM encrypted evidence store, forensic attachment scanning, GDPR Art 33 and Art 34 notice composers, exemption evaluation logic, and compliance bundle generation.

## Requirements & Scope
- **Encrypted Evidence Store (`packages/evidence/src/evidence-store.ts`)**:
  - PostgreSQL backing with Drizzle ORM (under dedicated `evidence` schema), encrypted at rest using AES-256-GCM (key from `EVIDENCE_KEY` via `sops`).
  - Staging area for incident attachments prior to upload.
  - Storage of SHA-256 hashes, multimodal scan results, draft packs, reviewer approvals, active leases, deduplication indexes, and queued risk signals.
  - Automatic retention pruning based on `RETENTION_NOTICE_YEARS`.
- **Multimodal Forensic Inspection (`packages/evidence/src/forensic-scanner.ts`)**:
  - Attachment metadata validation through the shared `assertAttachmentMeta` rule (`jpg,jpeg,png,tif,bmp,pdf,doc,docx,txt`, size ≤ 10 MB) plus content-signature verification with `file-type` (OLE2 magic for `.doc`).
  - Integration with `VISION_MODEL` for visual and PDF forensic analysis (OCR, IOC extraction, visual PII detection, tamper score). The scan result exposes `encryption_proof_signal` only; Art 34(3)(a) requires a separate structured `EncryptionProofAttestation`.
  - Parser-validated extraction for text and Word attachments (`Intl`/`TextDecoder` UTF-8 for `.txt`, `mammoth` for `.docx`, `word-extractor` for `.doc`); no binary-as-UTF-8 fallback. IOC and PII candidates are parser-validated (`net.isIP`, `tldts`, `libphonenumber-js` E.164, Spanish DNI/NIE checksum).
  - Computing SHA-256 pre-upload, post-upload re-download verification, and alerting on `ATTACHMENT_HASH_MISMATCH`.
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
- `packages/evidence/src/forensic-scanner.ts`: Attachment processor and hashing verifier.
- `packages/notices/src/notice-composer.ts`: Authority & subject notice builders.
- `packages/notices/src/exemption-engine.ts`: Decision table evaluator for Art 34(3) exemptions.
- `packages/evidence/src/bundle-sealer.ts`: Packaging and manifest generator.
- `tests/integration/evidence-store.test.ts`: Persistence and crypto verification tests with Testcontainers.
- `tests/unit/notice-composer.test.ts`: Notice composition and exemption evaluation tests (using `vi.mock`/`vi.spyOn`).

## Verification & Acceptance
- Art 33 pack produces valid schema with citations grounded in `gdpr-full`.
- Art 34(3)(a) exemption requires verifiable encryption evidence, rejecting ungrounded claims.
- Sealed bundle generates verifiable SHA-256 manifest and blocks modifications once sealed.
