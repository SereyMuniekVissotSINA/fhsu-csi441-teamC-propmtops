import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_STORAGE_KEY,
  assertDemoCanEdit,
  initialAccounts,
  readAccounts,
  updateAccounts,
  writeAccounts,
} from "./demo-accounts";
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
test("demo identities have distinct workspace permissions and sign out persists", () => {
  const storage = memoryStorage();
  const signedIn = updateAccounts(initialAccounts(), {
    type: "signIn",
    userId: "alex",
  });
  const snapshot = writeAccounts(storage, signedIn, null);
  assertDemoCanEdit(storage, "alex", "personal");
  const research = updateAccounts(signedIn, {
    type: "switch",
    workspaceId: "research",
  });
  const researchSnapshot = writeAccounts(storage, research, snapshot);
  assert.throws(
    () => assertDemoCanEdit(storage, "alex", "research"),
    /access changed/,
  );
  writeAccounts(
    storage,
    updateAccounts(research, { type: "signOut" }),
    researchSnapshot,
  );
  assert.equal(readAccounts(storage).state.userId, null);
});
test("owners manage membership without losing the last owner or mutating old state", () => {
  const state = updateAccounts(initialAccounts(), {
    type: "signIn",
    userId: "alex",
  });
  assert.throws(
    () => updateAccounts(state, { type: "member", userId: "alex", role: null }),
    /last owner/,
  );
  assert.equal(state.workspaces[0].members[0].role, "OWNER");
  const promoted = updateAccounts(state, {
    type: "member",
    userId: "sam",
    role: "OWNER",
  });
  const removed = updateAccounts(promoted, {
    type: "member",
    userId: "alex",
    role: null,
  });
  assert.equal(removed.workspaceId, "research");
  assert.throws(
    () => updateAccounts(removed, { type: "rotate", apiKey: "demo_new" }),
    /Only a workspace owner/,
  );
});
test("members cannot enter unauthorized workspaces or elevate their own roles", () => {
  const state = updateAccounts(initialAccounts(), {
    type: "signIn",
    userId: "jordan",
  });
  assert.throws(
    () => updateAccounts(state, { type: "switch", workspaceId: "research" }),
    /not a member/,
  );
  assert.throws(
    () =>
      updateAccounts(state, {
        type: "member",
        userId: "jordan",
        role: "OWNER",
      }),
    /Only a workspace owner/,
  );
  const created = updateAccounts(state, {
    type: "create",
    id: "new-team",
    name: " My team ",
    apiKey: "demo_team",
  });
  assert.equal(created.workspaceId, "new-team");
  assert.deepEqual(created.workspaces[2].members, [
    { userId: "jordan", role: "OWNER" },
  ]);
  assert.equal(created.workspaces[2].name, "My team");
});
test("storage rejects stale updates and preserves invalid stored data", () => {
  const storage = memoryStorage();
  const state = initialAccounts();
  writeAccounts(storage, state, null);
  assert.throws(() => writeAccounts(storage, state, null), /another tab/);
  storage.setItem(ACCOUNT_STORAGE_KEY, "broken");
  assert.throws(() => readAccounts(storage), /preserved/);
  assert.equal(storage.getItem(ACCOUNT_STORAGE_KEY), "broken");
});
test("fresh permission checks reject another tab's role revocation", () => {
  const storage = memoryStorage();
  const state = updateAccounts(initialAccounts(), {
    type: "signIn",
    userId: "sam",
  });
  const snapshot = writeAccounts(storage, state, null);
  assertDemoCanEdit(storage, "sam", "personal");
  state.workspaces[0].members.find((m) => m.userId === "sam")!.role = "VIEWER";
  writeAccounts(storage, state, snapshot);
  assert.throws(
    () => assertDemoCanEdit(storage, "sam", "personal"),
    /access changed/,
  );
});
test("failed persistence leaves previous data intact", () => {
  const storage = memoryStorage();
  const state = initialAccounts();
  const snapshot = writeAccounts(storage, state, null);
  assert.throws(
    () =>
      writeAccounts(
        {
          getItem: storage.getItem,
          setItem: () => {
            throw new Error("Quota exceeded");
          },
        },
        updateAccounts(state, { type: "signIn", userId: "alex" }),
        snapshot,
      ),
    /Quota/,
  );
  assert.equal(readAccounts(storage).state.userId, null);
});
