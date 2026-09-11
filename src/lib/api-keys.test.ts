import assert from "node:assert/strict";
import test from "node:test";

import { KEY_PREFIX, generateApiKey, hashKey, verifyApiKey } from "./api-keys";

test("generated keys are prefixed, unique, and long enough to be unguessable", () => {
  const a = generateApiKey();
  const b = generateApiKey();

  assert.ok(a.key.startsWith(KEY_PREFIX));
  assert.ok(a.prefix.startsWith(KEY_PREFIX));
  assert.notEqual(a.key, b.key, "two keys must never collide");
  // 32 random bytes in base64url, plus the prefix.
  assert.ok(a.key.length > 40, `key was only ${a.key.length} chars`);
});

test("only the hash is retained, and it is not the key itself", () => {
  const { key, hashedKey } = generateApiKey();

  assert.notEqual(hashedKey, key);
  assert.equal(hashedKey, hashKey(key));
  assert.equal(hashedKey.length, 64, "sha256 hex is 64 chars");
  assert.ok(!hashedKey.includes(key.slice(KEY_PREFIX.length)));
});

test("verifyApiKey accepts the real key and rejects near-misses", () => {
  const { key, hashedKey } = generateApiKey();

  assert.equal(verifyApiKey(key, hashedKey), true);
  assert.equal(verifyApiKey(key + "x", hashedKey), false);
  assert.equal(verifyApiKey(key.slice(0, -1), hashedKey), false);
  assert.equal(verifyApiKey("", hashedKey), false);
  assert.equal(verifyApiKey(generateApiKey().key, hashedKey), false);
});

test("verifying against a malformed stored hash is false, not a crash", () => {
  const { key } = generateApiKey();

  // A truncated or non-hex column value must not throw out of the request.
  assert.equal(verifyApiKey(key, "deadbeef"), false);
  assert.equal(verifyApiKey(key, ""), false);
});
