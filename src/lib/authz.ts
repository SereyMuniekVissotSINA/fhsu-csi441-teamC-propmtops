import { redirect } from "next/navigation";

import type { Session } from "next-auth";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { WorkspaceRole } from "@/generated/prisma/enums";
import { atLeast, canEdit, wouldOrphanWorkspace } from "@/lib/roles";

// Re-exported so callers have one import for authorization concerns.
export { atLeast, canEdit, wouldOrphanWorkspace };

// The one place workspace role rules live. Routes and pages call these instead
// of re-deriving "is this person allowed to..." each time.
//
// These mirror the rules the browser demo already enforces in
// `src/lib/demo-accounts.ts` — most importantly the last-owner guard, which is
// the rule that is easy to get wrong.

/** Thrown by the `require*` helpers so route handlers can map it to a status. */
export class AuthzError extends Error {
  constructor(
    readonly status: 401 | 403 | 404,
    message: string,
  ) {
    super(message);
    this.name = "AuthzError";
  }
}

/** For route handlers: the session, or an AuthzError the caller turns into 401. */
export async function requireSession(): Promise<Session> {
  const session = await auth();
  if (!session?.user?.id) throw new AuthzError(401, "You must be signed in.");
  return session;
}

/** For pages: the session, or a redirect to the sign-in page. */
export async function requireSessionPage(returnTo?: string): Promise<Session> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login");
  }
  return session;
}

/**
 * Assert the signed-in user belongs to `workspaceId` with at least `minimum`.
 * Returns their actual role so callers can branch further without a second query.
 */
export async function requireMember(
  workspaceId: string,
  minimum: WorkspaceRole = "VIEWER",
): Promise<{ session: Session; role: WorkspaceRole }> {
  const session = await requireSession();

  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: session.user.id, workspaceId } },
    select: { role: true },
  });

  // A non-member gets 404 rather than 403: confirming the workspace exists
  // would leak that it does.
  if (!membership) throw new AuthzError(404, "Workspace not found.");
  if (!atLeast(membership.role, minimum)) {
    throw new AuthzError(403, `This action requires the ${minimum} role.`);
  }

  return { session, role: membership.role };
}
