import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Workspace API keys.
//
// The demo stores keys in plain text (`demo_personal_preview_only`), which is
// fine for something that never leaves the browser. A real key is a credential,
// so only its sha256 is persisted: the plaintext is returned once at creation
// and is unrecoverable afterwards.

export const KEY_PREFIX = "pops_";

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey() {
  const key = KEY_PREFIX + randomBytes(32).toString("base64url");
  return {
    /** Show this to the user exactly once. */
    key,
    hashedKey: hashKey(key),
    /** Safe to display later so a key can be told apart from its siblings. */
    prefix: key.slice(0, KEY_PREFIX.length + 6),
  };
}

/** Constant-time compare, so a key cannot be recovered by timing the response. */
export function verifyApiKey(candidate: string, hashedKey: string): boolean {
  const a = Buffer.from(hashKey(candidate), "hex");
  const b = Buffer.from(hashedKey, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
