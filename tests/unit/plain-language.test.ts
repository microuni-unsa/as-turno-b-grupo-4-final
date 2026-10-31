import { PlainLanguageValidator } from "@pims/notices";
import {
  type NumericApproval,
  type PlainLanguageValidationOptions,
  PlainLanguageViolationError,
  SubjectCountForbiddenError,
} from "@pims/types";
import { describe, expect, it } from "vitest";

describe("Plain Language Validator (GDPR Art 34 Plain Language Rules)", () => {
  const reviewApprovalId = "00000000-0000-0000-0000-000000000001";
  const approvalFor = (value: string, occurrence = 0): NumericApproval => ({
    value,
    occurrence,
    reason: "reviewed by DPO",
    approval_id: reviewApprovalId,
  });

  describe("splitSentences", () => {
    it("splits sentences while preserving Spanish abbreviations", () => {
      const text =
        "De acuerdo con el Art. 34 del RGPD, notificamos el incidente a los interesados. Las medidas de mitigación fueron aplicadas de inmediato.";
      const sentences = PlainLanguageValidator.splitSentences(text);

      expect(sentences).toHaveLength(2);
      expect(sentences[0]).toBe(
        "De acuerdo con el Art. 34 del RGPD, notificamos el incidente a los interesados",
      );
      expect(sentences[1]).toBe(
        "Las medidas de mitigación fueron aplicadas de inmediato",
      );
    });

    it("keeps 'Dr. Smith vs. older baselines' as a single sentence and skips decimal numbers", () => {
      const text =
        "The server e.g. web01 was audited by Acme Inc. in consultation with Dr. Smith vs. older baselines. Version 1.5 patch has been deployed.";
      const sentences = PlainLanguageValidator.splitSentences(text, "en");

      expect(sentences).toHaveLength(2);
      expect(sentences[0]).toBe(
        "The server e.g. web01 was audited by Acme Inc. in consultation with Dr. Smith vs. older baselines",
      );
      expect(sentences[1]).toBe("Version 1.5 patch has been deployed");
    });

    it("splits on exclamation and question marks", () => {
      const text =
        "¡Alerta detectada! ¿Hubo exfiltración? No, el perímetro resistió.";
      const sentences = PlainLanguageValidator.splitSentences(text);

      expect(sentences).toHaveLength(3);
      expect(sentences[0]).toBe("¡Alerta detectada");
      expect(sentences[1]).toBe("¿Hubo exfiltración");
      expect(sentences[2]).toBe("No, el perímetro resistió");
    });

    it("splits on newlines", () => {
      const text = "Primera línea.\nSegunda línea.\r\nTercera línea.";
      const sentences = PlainLanguageValidator.splitSentences(text);

      expect(sentences).toHaveLength(3);
      expect(sentences[0]).toBe("Primera línea");
      expect(sentences[1]).toBe("Segunda línea");
      expect(sentences[2]).toBe("Tercera línea");
    });
  });

  describe("countWords", () => {
    it("counts word-like segments and ignores punctuation and spacing", () => {
      expect(PlainLanguageValidator.countWords("")).toBe(0);
      expect(PlainLanguageValidator.countWords("   ")).toBe(0);
      expect(PlainLanguageValidator.countWords("Palabra")).toBe(1);
      expect(
        PlainLanguageValidator.countWords("Una dos   tres \t cuatro \n cinco"),
      ).toBe(5);
      expect(
        PlainLanguageValidator.countWords("Dr. Smith vs. older baselines."),
      ).toBe(5);
    });
  });

  describe("Sentence length limit", () => {
    const withinLimit =
      "Hemos detectado un acceso no autorizado a los sistemas de información. El equipo técnico contuvo la brecha bloqueando las credenciales comprometidas. No se da ninguna acción pendiente.";

    it("passes when every sentence stays within the default limit", () => {
      expect(() => PlainLanguageValidator.validate(withinLimit)).not.toThrow();
      const validator = new PlainLanguageValidator();
      expect(() => validator.validate(withinLimit)).not.toThrow();
    });

    it("reports the offending sentence index and word count", () => {
      const sentence1 =
        "Esta primera frase es muy corta y tiene exactamente diez palabras.";
      const sentence2 =
        "Esta segunda frase es intencionalmente demasiado larga para superar el límite estricto de veinticinco palabras por oración exigido por las pautas de lenguaje claro y regulaciones de protección de datos personales aplicables en la Unión Europea.";

      try {
        PlainLanguageValidator.validate(`${sentence1} ${sentence2}`);
        expect.unreachable("Should have thrown PlainLanguageViolationError");
      } catch (err) {
        expect(err).toBeInstanceOf(PlainLanguageViolationError);
        const error = err as PlainLanguageViolationError;
        expect(error.sentenceIndex).toBe(2);
        expect(error.wordCount).toBe(36);
        expect(error.maxWords).toBe(25);
        expect(error.code).toBe("PLAIN_LANGUAGE_VIOLATION");
      }
    });

    it("skips the length check when a reviewer waiver object is supplied", () => {
      const longSentence =
        "Esta frase técnica contiene más de veinticinco palabras porque describe con sumo detalle las medidas forenses adoptadas por la entidad responsable durante la gestión del incidente de seguridad según los protocolos.";
      expect(PlainLanguageValidator.countWords(longSentence)).toBeGreaterThan(
        25,
      );

      const waiver = {
        reason: "technical wording",
        approval_id: reviewApprovalId,
      };
      expect(() =>
        PlainLanguageValidator.validate(longSentence, {
          plainLanguageWaiver: waiver,
        }),
      ).not.toThrow();

      const validatorWithWaiver = new PlainLanguageValidator({
        plainLanguageWaiver: waiver,
      });
      expect(() => validatorWithWaiver.validate(longSentence)).not.toThrow();
    });

    it("honours the maxWords override in the thrown error", () => {
      const sentence = "Uno dos tres cuatro cinco seis.";
      expect(PlainLanguageValidator.countWords(sentence)).toBe(6);

      expect(() =>
        PlainLanguageValidator.validate(sentence, { maxWords: 6 }),
      ).not.toThrow();

      try {
        PlainLanguageValidator.validate(sentence, { maxWords: 5 });
        expect.unreachable("Should have thrown PlainLanguageViolationError");
      } catch (err) {
        expect(err).toBeInstanceOf(PlainLanguageViolationError);
        expect((err as PlainLanguageViolationError).maxWords).toBe(5);
      }
    });
  });

  describe("Numeric literal approval", () => {
    it("rejects an unapproved subject count", () => {
      try {
        PlainLanguageValidator.validate("El incidente afectó a 500 personas.");
        expect.unreachable("Should have thrown SubjectCountForbiddenError");
      } catch (err) {
        expect(err).toBeInstanceOf(SubjectCountForbiddenError);
        const error = err as SubjectCountForbiddenError;
        expect(error.code).toBe("SUBJECT_COUNT_FORBIDDEN");
        expect(error.details).toEqual({
          value: "500",
          occurrence: 0,
          index: 0,
          reason: "NUMERIC_CONTENT_UNAPPROVED",
        });
      }
    });

    it("accepts a subject count approved token by token", () => {
      expect(() =>
        PlainLanguageValidator.validate("El incidente afectó a 500 personas.", {
          numericApprovals: [approvalFor("500")],
        }),
      ).not.toThrow();
    });

    it("detects comma-grouped and space-grouped literals", () => {
      for (const text of [
        "Se registraron 10,000 usuarios afectados.",
        "Se registraron 10 000 usuarios afectados.",
      ]) {
        expect(() => PlainLanguageValidator.validate(text)).toThrow(
          SubjectCountForbiddenError,
        );
      }

      const normalized = "Se registraron 10 000 usuarios afectados.";
      expect(() =>
        PlainLanguageValidator.validate(normalized, {
          numericApprovals: [approvalFor("10 000")],
        }),
      ).not.toThrow();
    });

    it("tracks occurrences of the same literal independently", () => {
      const text = "Revisamos 3 servidores y después 3 copias.";
      expect(() =>
        PlainLanguageValidator.validate(text, {
          numericApprovals: [approvalFor("3", 0), approvalFor("3", 1)],
        }),
      ).not.toThrow();

      expect(() =>
        PlainLanguageValidator.validate(text, {
          numericApprovals: [approvalFor("3", 0)],
        }),
      ).toThrow(SubjectCountForbiddenError);
    });

    it("treats benign numbers as unapproved by default", () => {
      expect(() =>
        PlainLanguageValidator.validate(
          "El incidente fue contenido en 24 horas con 3 servidores.",
        ),
      ).toThrow(SubjectCountForbiddenError);
    });

    it("rejects unknown option keys", () => {
      const legacyOptions = {
        allowSubjectCounts: true,
      } as unknown as PlainLanguageValidationOptions;
      expect(() =>
        PlainLanguageValidator.validate("Texto simple.", legacyOptions),
      ).toThrow();
    });
  });
});
