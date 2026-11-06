import { computeIncidentInputHash } from "@pims/agent/orchestrator/watcher.ts";
import {
  anchorFindingToIncident,
  blockedReasonToSpanish,
} from "@pims/cockpit/chat-tools.ts";
import { ComplianceFindingSchema } from "@pims/types/cockpit.ts";
import { CONSTANTS, SPANISH_OUTPUT_CONTRACT } from "@pims/types/constants.ts";
import type { PimsIncident } from "@pims/types/pims.ts";
import type { RetrievalPassage } from "@pims/types/rag.ts";
import { describe, expect, it } from "vitest";

describe("Compliance Queue & Decision Unit Tests", () => {
  it("SPANISH_OUTPUT_CONTRACT is defined and non-empty", () => {
    expect(SPANISH_OUTPUT_CONTRACT).toBeDefined();
    expect(SPANISH_OUTPUT_CONTRACT).toContain(
      "Responde íntegramente en español",
    );
  });

  describe("computeIncidentInputHash", () => {
    const baseIncident: PimsIncident = {
      id: 1,
      incident_code: "INC-TEST-001",
      title: "Ransomware infection on workstation",
      description: "Malware executed from suspicious phishing link",
      incident_type: "OT",
      status: "O",
      severity: "H",
      impact: "H",
      created_at: "2026-11-01T10:00:00Z",
      updated_at: "2026-11-01T10:00:00Z",
      is_deleted: false,
      incident_date: "2026-11-01T10:00:00Z",
      detection_date: "2026-11-01T10:00:00Z",
      resolved_date: null,
      affected_data_types: ["identificativos", "credentials"],
      num_affected_subjects: 250,
      compromised_system: "finance-ws-04",
      affected_url: "https://example.com",
      evidence_refs: "hash:abc1234",
      security_measures_adopted: ["network_seg"],
      affected_cid: ["C", "I"],
      involves_personal_data: true,
      measure_updated_registry: "N",
      measure_new_security: "Y",
      measure_improved_policies: "N",
      measure_considered_resolved: "N",
      measure_reported_authorities: "N",
      attachments_count: 2,
      actions_count: 1,
      history: [],
      reported_by: "Alice",
      assigned_to: "Bob",
    };

    it("produces deterministic 64-char sha256 hash", () => {
      const hash1 = computeIncidentInputHash(baseIncident);
      const hash2 = computeIncidentInputHash(baseIncident);
      expect(hash1).toHaveLength(64);
      expect(hash1).toBe(hash2);
    });

    it("changes hash when evidence_refs or status or affected data changes", () => {
      const initial = computeIncidentInputHash(baseIncident);

      const modifiedEvidence = {
        ...baseIncident,
        evidence_refs: "hash:abc1234,hash:def5678",
      };
      expect(computeIncidentInputHash(modifiedEvidence)).not.toBe(initial);

      const modifiedStatus: PimsIncident = {
        ...baseIncident,
        status: "P",
      };
      expect(computeIncidentInputHash(modifiedStatus)).not.toBe(initial);
    });

    it("ignores routing fields like reported_by and assigned_to", () => {
      const initial = computeIncidentInputHash(baseIncident);
      const rerouted = {
        ...baseIncident,
        reported_by: "Different Reporter",
        assigned_to: "Different Operator",
      };
      expect(computeIncidentInputHash(rerouted)).toBe(initial);
    });
  });

  describe("blockedReasonToSpanish", () => {
    it("maps model unavailable to Spanish fail-soft message", () => {
      const msg = blockedReasonToSpanish("MODEL_UNAVAILABLE:reasoning:timeout");
      expect(msg).toBe(
        "El modelo de lenguaje no respondió (tiempo de espera o servicio no disponible). Se conserva la última propuesta válida.",
      );
    });

    it("maps model schema violation to Spanish fail-soft message", () => {
      const msg = blockedReasonToSpanish(
        "MODEL_SCHEMA_VIOLATION:reasoning:missing field",
      );
      expect(msg).toBe(
        "El modelo devolvió un formato inválido. Se conserva la última propuesta válida.",
      );
    });

    it("maps rag no evidence to Spanish message", () => {
      const msg = blockedReasonToSpanish("RAG_NO_EVIDENCE");
      expect(msg).toBe("Sin evidencia normativa sobre el umbral mínimo.");
    });

    it("maps pack stale retry to Spanish message", () => {
      const msg = blockedReasonToSpanish("PACK_STALE_RETRY");
      expect(msg).toBe(
        "La propuesta quedó desactualizada durante la generación.",
      );
    });

    it("maps unknown or null code to default Spanish message", () => {
      expect(blockedReasonToSpanish(null)).toBe(
        "El ciclo autónomo se detuvo con error.",
      );
      expect(blockedReasonToSpanish("UNKNOWN_ERROR")).toBe(
        "El ciclo autónomo se detuvo con error.",
      );
    });
  });

  describe("anchorFindingToIncident", () => {
    const dummyPassage: RetrievalPassage = {
      chunk_id: "0001",
      doc_id: "iso27701",
      article_or_clause: "Clause 6.1.2 Privacy risk assessment",
      lines: "1-10",
      text: "The organization shall define and apply a privacy risk assessment process.",
      normative: true,
      score: 0.85,
      rank: 1,
      chunk_sha256: "0".repeat(CONSTANTS.SHA256_HEX_LENGTH),
      dense_score: 0.9,
      dense_rank: 1,
      bm25_score: 1.5,
      bm25_rank: 1,
      rrf_score: 0.03,
      rerank_score: 0.85,
    };

    it("maps risk/assessment clauses to Evaluación de riesgo", () => {
      const anchor = anchorFindingToIncident(dummyPassage);
      expect(anchor).toBe("Evaluación de riesgo (severidad/impacto)");
    });

    it("maps breach/notification clauses to Notificación y plazos", () => {
      const passage: RetrievalPassage = {
        ...dummyPassage,
        doc_id: "gdpr-full",
        article_or_clause: "Article 33 Notification of a personal data breach",
        text: "In the case of a personal data breach, the controller shall notify.",
      };
      const anchor = anchorFindingToIncident(passage);
      expect(anchor).toBe("Notificación y plazos");
    });

    it("maps encryption/security clauses to Medidas de seguridad adoptadas", () => {
      const passage: RetrievalPassage = {
        ...dummyPassage,
        article_or_clause: "Control A.3.26 Use of cryptography",
        text: "Use of encryption and cryptographic key management shall be defined.",
      };
      const anchor = anchorFindingToIncident(passage);
      expect(anchor).toBe("Medidas de seguridad adoptadas");
    });

    it("maps default clauses to Descripción del incidente", () => {
      const passage: RetrievalPassage = {
        ...dummyPassage,
        article_or_clause: "Clause 4.1 Understanding the organization",
        text: "The organization shall determine external and internal issues.",
      };
      const anchor = anchorFindingToIncident(passage);
      expect(anchor).toBe("Descripción del incidente");
    });
  });

  describe("ComplianceFindingSchema", () => {
    it("validates strict schema and rejects loose fields", () => {
      const valid = {
        citation: "iso27701:0001:1-10",
        doc_id: "iso27701",
        chunk_id: "0001",
        lines: "1-10",
        chunk_sha256: "a".repeat(64),
        dense_score: 0.95,
        bm25_rank: 1,
        rrf_score: 0.03,
        rerank_score: 0.88,
        text: "Some normative quote",
        incident_anchor: "Evaluación de riesgo (severidad/impacto)",
        framework: "iso27701" as const,
      };

      const parsed = ComplianceFindingSchema.parse(valid);
      expect(parsed.doc_id).toBe("iso27701");
      expect(parsed.framework).toBe("iso27701");

      // Rejects extra field because schema is strict
      expect(() =>
        ComplianceFindingSchema.parse({ ...valid, extra: "unallowed" }),
      ).toThrow();
    });
  });
});
