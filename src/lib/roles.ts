import type { WorkspaceRole } from "@/generated/prisma/enums";

// Pure role logic, deliberately free of imports that touch auth, Prisma, or the
// environment. `src/lib/authz.ts` pulls in `@/auth`, which validates env at
// module load — keeping these here means they stay unit-testable on their own.

const rank: Record<WorkspaceRole, number> = { VIEWER: 0, EDITOR: 1, OWNER: 2 };

export function atLeast(role: WorkspaceRole, minimum: WorkspaceRole): boolean {
  return rank[role] >= rank[minimum];
}

export function canEdit(role: WorkspaceRole): boolean {
  return atLeast(role, "EDITOR");
}

/**
 * Guard for removing or demoting a member. A workspace must always keep at
 * least one OWNER, otherwise it becomes permanently unmanageable.
 *
 * `nextRole` is null when the member is being removed outright.
 */
export function wouldOrphanWorkspace(
  members: Array<{ userId: string; role: WorkspaceRole }>,
  targetUserId: string,
  nextRole: WorkspaceRole | null,
): boolean {
  const remaining = members
    .filter((m) => m.userId !== targetUserId)
    .concat(nextRole ? [{ userId: targetUserId, role: nextRole }] : []);

  return !remaining.some((m) => m.role === "OWNER");
}
