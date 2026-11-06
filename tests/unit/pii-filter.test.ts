import type { PresidioRecognizerResult } from "@pims/types/cockpit.ts";
import {
  filterAuthenticPiiSpans,
  stripCitationOverlappingSpans,
} from "@pims/types/pii.ts";
import { describe, expect, it } from "vitest";

describe("filterAuthenticPiiSpans", () => {
  it("blocks authentic PII (phone number, DNI, email, person)", () => {
    const text =
      "Contacto: 987654321, DNI 12345678, correo juan@unsa.edu.pe, afectado Juan Perez.";
    const phoneStart = text.indexOf("987654321");
    const dniStart = text.indexOf("12345678");
    const emailStart = text.indexOf("juan@unsa.edu.pe");
    const personStart = text.indexOf("Juan Perez");

    const spans: PresidioRecognizerResult[] = [
      {
        entity_type: "PHONE_NUMBER",
        score: 0.85,
        start: phoneStart,
        end: phoneStart + "987654321".length,
      },
      {
        entity_type: "PE_DNI",
        score: 0.95,
        start: dniStart,
        end: dniStart + "12345678".length,
      },
      {
        entity_type: "EMAIL_ADDRESS",
        score: 1.0,
        start: emailStart,
        end: emailStart + "juan@unsa.edu.pe".length,
      },
      {
        entity_type: "PERSON",
        score: 0.85,
        start: personStart,
        end: personStart + "Juan Perez".length,
      },
    ];
    const filtered = filterAuthenticPiiSpans(text, spans);
    expect(filtered).toHaveLength(4);
  });

  it("filters out false positive phone numbers inside SHA-256 hashes", () => {
    const text =
      "Evidencia con hash `31fc535e15c503f61863b21f8bd57b6c415157ee04557eff6c89d54476592af3` verificada.";
    const spanStart = text.indexOf("415157");
    const spans: PresidioRecognizerResult[] = [
      {
        entity_type: "PHONE_NUMBER",
        score: 0.85,
        start: spanStart,
        end: spanStart + 6,
      },
    ];
    const filtered = filterAuthenticPiiSpans(text, spans);
    expect(filtered).toHaveLength(0);
  });

  it("filters out false positive phone numbers inside UUIDs", () => {
    const text = "Pack ID 6383f14a-974b-4898-ade9-09bb428251a5 registrado.";
    const spanStart = text.indexOf("428251");
    const spans: PresidioRecognizerResult[] = [
      {
        entity_type: "PHONE_NUMBER",
        score: 0.85,
        start: spanStart,
        end: spanStart + 6,
      },
    ];
    const filtered = filterAuthenticPiiSpans(text, spans);
    expect(filtered).toHaveLength(0);
  });

  it("filters out institutional terms misclassified as PERSON (San Agustín, Decano, etc.)", () => {
    const text =
      "La comunidad de San Agustín y el Decano evaluaron el incidente.";
    const sanAgustinStart = text.indexOf("San Agustín");
    const decanoStart = text.indexOf("Decano");
    const spans: PresidioRecognizerResult[] = [
      {
        entity_type: "PERSON",
        score: 0.85,
        start: sanAgustinStart,
        end: sanAgustinStart + "San Agustín".length,
      },
      {
        entity_type: "PERSON",
        score: 0.85,
        start: decanoStart,
        end: decanoStart + "Decano".length,
      },
    ];
    const filtered = filterAuthenticPiiSpans(text, spans);
    expect(filtered).toHaveLength(0);
  });

  it("drops phone/location spans overlapping normative citations", () => {
    const text =
      "C1 = gdpr-full:gdpr-full:0134:2411-2475 y C2 = iso27701:iso27701:0026:347-380.";
    const phoneStart = text.indexOf("347-380");
    const locationStart = text.indexOf("gdpr-full:0134:2411-2475");
    const spans: PresidioRecognizerResult[] = [
      {
        entity_type: "PHONE_NUMBER",
        score: 0.85,
        start: phoneStart,
        end: phoneStart + "347-380".length,
      },
      {
        entity_type: "LOCATION",
        score: 0.85,
        start: locationStart,
        end: locationStart + "gdpr-full:0134:2411-2475".length,
      },
    ];
    expect(stripCitationOverlappingSpans(text, spans)).toHaveLength(0);
    expect(filterAuthenticPiiSpans(text, spans)).toHaveLength(0);
  });

  it("keeps standalone phone spans outside citations", () => {
    const text = "Llame al 987654321 según gdpr-full:gdpr-full:0134:2411-2475.";
    const phoneStart = text.indexOf("987654321");
    const citationPhoneStart = text.indexOf("2411-2475");
    const spans: PresidioRecognizerResult[] = [
      {
        entity_type: "PHONE_NUMBER",
        score: 0.85,
        start: phoneStart,
        end: phoneStart + "987654321".length,
      },
      {
        entity_type: "PHONE_NUMBER",
        score: 0.85,
        start: citationPhoneStart,
        end: citationPhoneStart + "2411-2475".length,
      },
    ];
    const filtered = filterAuthenticPiiSpans(text, spans);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.start).toBe(phoneStart);
  });
});
