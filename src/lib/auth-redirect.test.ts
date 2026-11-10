import assert from "node:assert/strict";
import test from "node:test";
import { authRedirect } from "./auth-redirect";

test("preserves protected destinations", () => {
  assert.equal(authRedirect("/dashboard/explorer?q=hello"), "/dashboard/explorer?q=hello");
});
test("rejects external URLs, misleading paths, and auth loops", () => {
  for (const input of [null, "//evil.test", "https://evil.test", "/dashboard/../../login", "/login", "/dashboard-other", "/\\evil.test"]) {
    assert.equal(authRedirect(input), "/dashboard");
  }
});
