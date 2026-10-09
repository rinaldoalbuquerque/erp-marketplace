import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decryptSecret,
  encryptSecret,
  parseEncryptionKey,
  SecretBoxError,
} from "@/server/crypto/secret-box";

const key = randomBytes(32);
const token = "APP_USR-123456-090515-8cc4448aac10d5105474e1351-1234567";

describe("secret box", () => {
  it("round-trips a secret", () => {
    expect(decryptSecret(encryptSecret(token, key), key)).toBe(token);
  });

  it("never stores the plaintext and uses a fresh IV every time", () => {
    const first = encryptSecret(token, key);
    const second = encryptSecret(token, key);
    expect(first).not.toContain(token);
    expect(first).toMatch(/^v1:/);
    expect(first).not.toBe(second);
  });

  it("rejects a tampered value", () => {
    const encrypted = encryptSecret(token, key);
    // Flip a real byte (changing the last base64 character may only touch padding bits).
    const payload = Buffer.from(encrypted.slice("v1:".length), "base64url");
    payload[payload.length - 1] = payload[payload.length - 1]! ^ 0x01;
    const tampered = `v1:${payload.toString("base64url")}`;
    expect(() => decryptSecret(tampered, key)).toThrow(SecretBoxError);
  });

  it("rejects the wrong key without leaking the secret", () => {
    const encrypted = encryptSecret(token, key);
    expect(() => decryptSecret(encrypted, randomBytes(32))).toThrow(SecretBoxError);
    try {
      decryptSecret(encrypted, randomBytes(32));
    } catch (error) {
      expect(String(error)).not.toContain(token);
    }
  });

  it("rejects unknown formats", () => {
    expect(() => decryptSecret("plain-token", key)).toThrow(SecretBoxError);
    expect(() => decryptSecret("v2:abc", key)).toThrow(SecretBoxError);
  });

  it("validates the key size", () => {
    expect(parseEncryptionKey(randomBytes(32).toString("base64")).length).toBe(32);
    expect(() => parseEncryptionKey(randomBytes(16).toString("base64"))).toThrow(SecretBoxError);
    expect(() => parseEncryptionKey("")).toThrow(SecretBoxError);
  });
});
