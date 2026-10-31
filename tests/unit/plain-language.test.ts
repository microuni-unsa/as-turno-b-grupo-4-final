import { PlainLanguageValidator } from "@pims/notices";
import {
  PlainLanguageViolationError,
  SubjectCountForbiddenError,
} from "@pims/types";
import { describe, expect, it } from "vitest";

describe("Plain Language Validator (GDPR Art 34 Plain Language Rules)", () => {
  describe("splitSentences", () => {
    it("splits sentences while preserving Spanish & English abbreviations", () => {
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

    it("does not split on abbreviations such as 'e.g.', 'inc.', 'dr.', 'vs.', and decimal numbers like '1.5'", () => {
      const text =
        "The server e.g. web01 was audited by Acme Inc. in consultation with Dr. Smith vs. older baselines. Version 1.5 patch has been deployed.";
      const sentences = PlainLanguageValidator.splitSentences(text);

      expect(sentences).toHaveLength(2);
      expect(sentences[0]).toBe(
        "The server e.g. web01 was audited by Acme Inc. in consultation with Dr. Smith vs. older baselines",
      );
      expect(sentences[1]).toBe("Version 1.5 patch has been deployed");
    });

    it("splits on multiple punctuation marks including exclamation and question marks", () => {
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
    it("accurately counts words with normal, irregular, and whitespace-heavy spacing", () => {
      expect(PlainLanguageValidator.countWords("")).toBe(0);
      expect(PlainLanguageValidator.countWords("   ")).toBe(0);
      expect(PlainLanguageValidator.countWords("Palabra")).toBe(1);
      expect(
        PlainLanguageValidator.countWords("Una dos   tres \t cuatro \n cinco"),
      ).toBe(5);
    });
  });

  describe("Sentence Length Limit Validation (<= 25 words)", () => {
    it("passes cleanly when all sentences are 25 words or fewer", () => {
      const text =
        "Hemos detectado un acceso no autorizado a los sistemas de información. El equipo técnico contuvo la brecha bloqueando las credenciales comprometidas. No se requiere ninguna acción adicional.";
      expect(() => PlainLanguageValidator.validate(text)).not.toThrow();

      const validator = new PlainLanguageValidator();
      expect(() => validator.validate(text)).not.toThrow();
    });

    it("throws PlainLanguageViolationError when a sentence exceeds 25 words with sentence index and word count", () => {
      const sentence1 =
        "Esta primera frase es muy corta y tiene exactamente diez palabras.";
      const sentence2 =
        "Esta segunda frase es intencionalmente demasiado larga para superar el límite estricto de veinticinco palabras por oración exigido por las pautas de lenguaje claro y regulaciones de protección de datos personales aplicables en la Unión Europea.";

      const text = `${sentence1} ${sentence2}`;

      expect(() => PlainLanguageValidator.validate(text)).toThrow(
        PlainLanguageViolationError,
      );

      try {
        PlainLanguageValidator.validate(text);
        expect.unreachable("Should have thrown PlainLanguageViolationError");
      } catch (err) {
        expect(err).toBeInstanceOf(PlainLanguageViolationError);
        const error = err as PlainLanguageViolationError;
        expect(error.sentenceIndex).toBe(2);
        expect(error.wordCount).toBe(36);
        expect(error.code).toBe("PLAIN_LANGUAGE_VIOLATION");
      }
    });

    it("allows sentences exceeding 25 words when plainLanguageWaiver is true", () => {
      const longSentence =
        "Esta frase técnica contiene más de veinticinco palabras porque describe con sumo detalle las medidas forenses adoptadas por la entidad responsable durante la gestión del incidente de seguridad según los protocolos.";
      expect(PlainLanguageValidator.countWords(longSentence)).toBeGreaterThan(
        25,
      );

      expect(() =>
        PlainLanguageValidator.validate(longSentence, {
          plainLanguageWaiver: true,
        }),
      ).not.toThrow();

      const validatorWithWaiver = new PlainLanguageValidator({
        plainLanguageWaiver: true,
      });
      expect(() => validatorWithWaiver.validate(longSentence)).not.toThrow();
    });
  });

  describe("Subject Count Prohibition Validation", () => {
    it("throws SubjectCountForbiddenError when text contains victim counts in Spanish", () => {
      const phrases = [
        "El incidente afectó a 500 personas en total.",
        "Se registraron 10,000 usuarios afectados por la brecha.",
        "El evento involucra a 150 titulares.",
        "Total de víctimas: 250 en la base de datos.",
      ];

      for (const phrase of phrases) {
        expect(() => PlainLanguageValidator.validate(phrase)).toThrow(
          SubjectCountForbiddenError,
        );
        try {
          PlainLanguageValidator.validate(phrase);
          expect.unreachable("Should have thrown SubjectCountForbiddenError");
        } catch (err) {
          expect(err).toBeInstanceOf(SubjectCountForbiddenError);
          const error = err as SubjectCountForbiddenError;
          expect(error.code).toBe("SUBJECT_COUNT_FORBIDDEN");
        }
      }
    });

    it("throws SubjectCountForbiddenError when text contains victim counts in English", () => {
      const phrases = [
        "The security incident is affecting 200 individuals.",
        "A total of 5,000 users were compromised.",
        "The leak resulted in 100 accounts exposed.",
      ];

      for (const phrase of phrases) {
        expect(() => PlainLanguageValidator.validate(phrase)).toThrow(
          SubjectCountForbiddenError,
        );
      }
    });

    it("allows victim counts when allowSubjectCounts is true", () => {
      const phrase =
        "El incidente afectó a 500 personas según el reporte técnico preliminar.";

      expect(() =>
        PlainLanguageValidator.validate(phrase, {
          allowSubjectCounts: true,
        }),
      ).not.toThrow();

      const validator = new PlainLanguageValidator({
        allowSubjectCounts: true,
      });
      expect(() => validator.validate(phrase)).not.toThrow();
    });

    it("allows general numbers not referring to affected subjects", () => {
      const text =
        "El incidente fue contenido en 24 horas utilizando 3 servidores de contingencia bajo la versión 2 del protocolo.";
      expect(() => PlainLanguageValidator.validate(text)).not.toThrow();
    });
  });
});
