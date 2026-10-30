import fs from "node:fs";
import { decryptSopsFile } from "@pims/config";
import { describe, expect, it } from "vitest";

describe("SOPS decryption (integration)", () => {
  it("decrypts credentials.enc.json with valid SOPS age keys", () => {
    expect(fs.existsSync("credentials.enc.json")).toBe(true);
    const creds = decryptSopsFile("credentials.enc.json");
    expect(creds.OPENAI_API_KEY).toBeDefined();
    expect(creds.EVIDENCE_KEY).toBeDefined();
  });
});
