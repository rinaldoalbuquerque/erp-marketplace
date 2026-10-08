import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Encryption for secrets stored in the database (marketplace tokens).
// AES-256-GCM: confidentiality + integrity (a tampered value fails to decrypt).
// Format: "v1:" + base64url(iv[12] | authTag[16] | ciphertext). The version
// prefix allows rotating the algorithm or key later without guessing formats.

const VERSION = "v1";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxError";
  }
}

/** Decodes TOKEN_ENCRYPTION_KEY (base64 of exactly 32 random bytes). */
export function parseEncryptionKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key.trim(), "base64");
  if (key.length !== 32) {
    throw new SecretBoxError("TOKEN_ENCRYPTION_KEY must be base64 of 32 bytes.");
  }
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  return `${VERSION}:${payload.toString("base64url")}`;
}

export function decryptSecret(encrypted: string, key: Buffer): string {
  const [version, data] = encrypted.split(":", 2);
  if (version !== VERSION || !data) throw new SecretBoxError("Unknown secret format.");
  const payload = Buffer.from(data, "base64url");
  if (payload.length < IV_LENGTH + TAG_LENGTH) throw new SecretBoxError("Secret is too short.");
  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH + TAG_LENGTH);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key or tampered data. Never include the secret in the message.
    throw new SecretBoxError("Could not decrypt secret (wrong key or corrupted value).");
  }
}
