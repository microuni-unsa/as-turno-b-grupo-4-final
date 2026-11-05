import crypto from "node:crypto";
import { CONSTANTS } from "@pims/types/constants.ts";
import {
  EvidenceDecryptionError,
  EvidenceStoreEncryptionError,
} from "@pims/types/errors.ts";

export { EvidenceDecryptionError };

const AES_256_GCM_ALGORITHM = "aes-256-gcm";
const EXPECTED_KEY_HEX_LENGTH = CONSTANTS.SHA256_HEX_LENGTH;
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

  if (plaintext === undefined || plaintext === null) {
    throw new EvidenceStoreEncryptionError(
      "Plaintext payload cannot be null or undefined",
    );
  }

  let plainBuf: Buffer;
  if (Buffer.isBuffer(plaintext)) {
    plainBuf = plaintext;
  } else if (typeof plaintext === "string") {
    plainBuf = Buffer.from(plaintext, "utf8");
  } else {
    throw new EvidenceStoreEncryptionError(
      "Plaintext payload must be a Buffer or string",
    );
  }

  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const key = Buffer.from(keyHex, "hex");
  const cipher = crypto.createCipheriv(AES_256_GCM_ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, ciphertext]);
}

export function decryptPayload(encrypted: Buffer, keyHex: string): Buffer {
  validateKeyHex(keyHex);

  if (!Buffer.isBuffer(encrypted)) {
    throw new EvidenceStoreEncryptionError(
      "Encrypted payload must be a Buffer",
    );
  }

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
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted;
  } catch (err) {
    if (err instanceof EvidenceDecryptionError) {
      throw err;
    } else {
      throw new EvidenceDecryptionError(
        "Decryption failed or authentication tag mismatch",
        { cause: err instanceof Error ? err.message : String(err) },
      );
    }
  }
}

export const encryptData = encryptPayload;
export const decryptData = decryptPayload;

export function timingSafeEqualBuffers(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}
