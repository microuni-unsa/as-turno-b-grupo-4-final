import crypto from "node:crypto";
import { EvidenceStoreEncryptionError } from "@pims/types/errors.ts";

const AES_256_GCM_ALGORITHM = "aes-256-gcm";
const EXPECTED_KEY_HEX_LENGTH = 64;
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const MIN_ENCRYPTED_LENGTH_BYTES = IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES;

function validateKeyHex(keyHex: string): void {
  if (
    typeof keyHex !== "string" ||
    keyHex.length !== EXPECTED_KEY_HEX_LENGTH ||
    !/^[0-9a-fA-F]{64}$/.test(keyHex)
  ) {
    throw new EvidenceStoreEncryptionError(
      "Invalid key length: must be 32 bytes (64 hex characters)",
    );
  }
}

export function encryptPayload(
  plaintext: Buffer | string,
  keyHex: string,
): Buffer {
  validateKeyHex(keyHex);

  const plainBuf = Buffer.isBuffer(plaintext)
    ? plaintext
    : Buffer.from(plaintext, "utf8");

  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const key = Buffer.from(keyHex, "hex");
  const cipher = crypto.createCipheriv(AES_256_GCM_ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, ciphertext]);
}

export function decryptPayload(encrypted: Buffer, keyHex: string): Buffer {
  validateKeyHex(keyHex);

  if (encrypted.length < MIN_ENCRYPTED_LENGTH_BYTES) {
    throw new EvidenceStoreEncryptionError(
      `Encrypted payload too short: minimum ${MIN_ENCRYPTED_LENGTH_BYTES} bytes required (12 IV + 16 Tag)`,
    );
  }

  const iv = encrypted.subarray(0, IV_LENGTH_BYTES);
  const tag = encrypted.subarray(
    IV_LENGTH_BYTES,
    IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES,
  );
  const ciphertext = encrypted.subarray(
    IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES,
  );

  const key = Buffer.from(keyHex, "hex");

  try {
    const decipher = crypto.createDecipheriv(AES_256_GCM_ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (_err) {
    throw new EvidenceStoreEncryptionError(
      "Decryption failed or authentication tag mismatch",
    );
  }
}
