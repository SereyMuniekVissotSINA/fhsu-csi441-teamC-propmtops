import assert from "node:assert/strict";
import test from "node:test";

import { atLeast, canEdit, wouldOrphanWorkspace } from "./roles";

test("role ranking is ordered, not just equality", () => {
  assert.equal(atLeast("OWNER", "VIEWER"), true);
  assert.equal(atLeast("EDITOR", "VIEWER"), true);
  assert.equal(atLeast("EDITOR", "EDITOR"), true);
  assert.equal(atLeast("VIEWER", "EDITOR"), false);
  assert.equal(atLeast("EDITOR", "OWNER"), false);
});

test("viewers cannot edit, editors and owners can", () => {
  assert.equal(canEdit("VIEWER"), false);
  assert.equal(canEdit("EDITOR"), true);
  assert.equal(canEdit("OWNER"), true);
});

test("the last owner cannot be demoted or removed", () => {
  const members = [
    { userId: "alex", role: "OWNER" as const },
    { userId: "sam", role: "EDITOR" as const },
  ];

  // Demoting the only owner would leave nobody able to manage the workspace.
  assert.equal(wouldOrphanWorkspace(members, "alex", "EDITOR"), true);
  assert.equal(wouldOrphanWorkspace(members, "alex", null), true);
});

test("removing a non-owner, or one of several owners, is allowed", () => {
  const members = [
    { userId: "alex", role: "OWNER" as const },
    { userId: "sam", role: "EDITOR" as const },
  ];
  assert.equal(wouldOrphanWorkspace(members, "sam", null), false);

  const twoOwners = [
    { userId: "alex", role: "OWNER" as const },
    { userId: "jordan", role: "OWNER" as const },
  ];
  assert.equal(wouldOrphanWorkspace(twoOwners, "alex", "VIEWER"), false);
  assert.equal(wouldOrphanWorkspace(twoOwners, "alex", null), false);
});

test("promoting someone to owner is never orphaning", () => {
  const members = [
    { userId: "alex", role: "OWNER" as const },
    { userId: "sam", role: "EDITOR" as const },
  ];
  assert.equal(wouldOrphanWorkspace(members, "sam", "OWNER"), false);
});
