import crypto from "node:crypto";
import { decryptPayload, encryptPayload } from "@pims/evidence";
import { EvidenceStoreEncryptionError } from "@pims/types";
import { describe, expect, it } from "vitest";

describe("Evidence Store Cryptographic Primitives (AES-256-GCM)", () => {
  const validHexKey =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  describe("Key Validation", () => {
    it("accepts a 64-hex character key", () => {
      const plaintext = "valid-key-test";
      const encrypted = encryptPayload(plaintext, validHexKey);
      expect(encrypted).toBeInstanceOf(Buffer);
      const decrypted = decryptPayload(encrypted, validHexKey);
      expect(decrypted.toString("utf8")).toBe(plaintext);
    });

    it("throws EvidenceStoreEncryptionError when key is shorter than 64 characters", () => {
      const shortKey = "0123456789abcdef";
      expect(() => encryptPayload("test", shortKey)).toThrow(
        EvidenceStoreEncryptionError,
      );
      expect(() => encryptPayload("test", shortKey)).toThrow(
        "Invalid key length: must be 32 bytes (64 hex characters)",
      );
    });

    it("throws EvidenceStoreEncryptionError when key is longer than 64 characters", () => {
      const longKey = `${validHexKey}00`;
      expect(() => encryptPayload("test", longKey)).toThrow(
        EvidenceStoreEncryptionError,
      );
    });

    it("throws EvidenceStoreEncryptionError when key contains non-hexadecimal characters", () => {
      const nonHexKey = "g".repeat(64);
      expect(() => encryptPayload("test", nonHexKey)).toThrow(
        EvidenceStoreEncryptionError,
      );
    });

    it("throws EvidenceStoreEncryptionError when key is empty or invalid type in decryptPayload", () => {
      const dummyEncrypted = Buffer.alloc(32);
      expect(() => decryptPayload(dummyEncrypted, "")).toThrow(
        EvidenceStoreEncryptionError,
      );
      expect(() =>
        decryptPayload(dummyEncrypted, "non-hex-key-that-is-way-too-short"),
      ).toThrow(EvidenceStoreEncryptionError);
    });
  });

  describe("Payload Encryption & Decryption Round-Trip", () => {
    it("encrypts and decrypts string payloads correctly", () => {
      const plaintext =
        "Art. 33/34 forensic bundle evidence payload with UTF-8: ñ, é, ü, 🚀";
      const encrypted = encryptPayload(plaintext, validHexKey);

      expect(encrypted).toBeInstanceOf(Buffer);
      expect(encrypted.length).toBeGreaterThan(28);

      const decrypted = decryptPayload(encrypted, validHexKey);
      expect(decrypted.toString("utf8")).toBe(plaintext);
    });

    it("encrypts and decrypts binary Buffer payloads correctly", () => {
      const binaryPayload = crypto.randomBytes(512);
      const encrypted = encryptPayload(binaryPayload, validHexKey);

      expect(encrypted).toBeInstanceOf(Buffer);
      expect(encrypted.length).toBe(binaryPayload.length + 12 + 16);

      const decrypted = decryptPayload(encrypted, validHexKey);
      expect(decrypted.equals(binaryPayload)).toBe(true);
    });

    it("handles empty string payload round-trip", () => {
      const emptyPlaintext = "";
      const encrypted = encryptPayload(emptyPlaintext, validHexKey);

      expect(encrypted.length).toBe(28);
      const decrypted = decryptPayload(encrypted, validHexKey);
      expect(decrypted.toString("utf8")).toBe(emptyPlaintext);
    });
  });

  describe("Tampering & Integrity Detection", () => {
    it("throws EvidenceStoreEncryptionError when ciphertext bytes are corrupted", () => {
      const plaintext = "Forensic critical evidence";
      const encrypted = encryptPayload(plaintext, validHexKey);

      const corrupted = Buffer.from(encrypted);
      const ciphertextOffset = 28;
      if (ciphertextOffset >= corrupted.length) {
        throw new Error("Ciphertext offset out of bounds");
      }
      const originalByte = corrupted[ciphertextOffset];
      if (originalByte === undefined) {
        throw new Error("Byte at ciphertext offset undefined");
      }
      corrupted[ciphertextOffset] = originalByte ^ 0xff;

      expect(() => decryptPayload(corrupted, validHexKey)).toThrow(
        EvidenceStoreEncryptionError,
      );
      expect(() => decryptPayload(corrupted, validHexKey)).toThrow(
        "Decryption failed or authentication tag mismatch",
      );
    });

    it("throws EvidenceStoreEncryptionError when authentication tag bytes are corrupted", () => {
      const plaintext = "Integrity check test payload";
      const encrypted = encryptPayload(plaintext, validHexKey);

      const corrupted = Buffer.from(encrypted);
      const tagOffset = 15;
      if (tagOffset >= corrupted.length) {
        throw new Error("Tag offset out of bounds");
      }
      const originalByte = corrupted[tagOffset];
      if (originalByte === undefined) {
        throw new Error("Byte at tag offset undefined");
      }
      corrupted[tagOffset] = originalByte ^ 0x01;

      expect(() => decryptPayload(corrupted, validHexKey)).toThrow(
        EvidenceStoreEncryptionError,
      );
      expect(() => decryptPayload(corrupted, validHexKey)).toThrow(
        "Decryption failed or authentication tag mismatch",
      );
    });

    it("throws EvidenceStoreEncryptionError when IV bytes are corrupted", () => {
      const plaintext = "IV modification test";
      const encrypted = encryptPayload(plaintext, validHexKey);

      const corrupted = Buffer.from(encrypted);
      const ivOffset = 4;
      if (ivOffset >= corrupted.length) {
        throw new Error("IV offset out of bounds");
      }
      const originalByte = corrupted[ivOffset];
      if (originalByte === undefined) {
        throw new Error("Byte at IV offset undefined");
      }
      corrupted[ivOffset] = originalByte ^ 0x5a;

      expect(() => decryptPayload(corrupted, validHexKey)).toThrow(
        EvidenceStoreEncryptionError,
      );
    });

    it("throws EvidenceStoreEncryptionError when decrypting with wrong 64-hex key", () => {
      const plaintext = "Secret payload";
      const encrypted = encryptPayload(plaintext, validHexKey);

      const differentHexKey =
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

      expect(() => decryptPayload(encrypted, differentHexKey)).toThrow(
        EvidenceStoreEncryptionError,
      );
    });
  });

  describe("Encrypted Buffer Minimum Length Validation", () => {
    it("throws EvidenceStoreEncryptionError when decrypting buffer shorter than 28 bytes", () => {
      const shortBuffers = [
        Buffer.alloc(0),
        Buffer.alloc(11),
        Buffer.alloc(12),
        Buffer.alloc(27),
      ];

      for (const buf of shortBuffers) {
        expect(() => decryptPayload(buf, validHexKey)).toThrow(
          EvidenceStoreEncryptionError,
        );
        expect(() => decryptPayload(buf, validHexKey)).toThrow(
          "Encrypted payload too short: minimum 28 bytes required (12 IV + 16 Tag)",
        );
      }
    });
  });
});
