import type { WorkspaceRole } from "@/generated/prisma/enums";
import { KEY_PREFIX, hashKey, verifyApiKey } from "@/lib/api-keys";
import { AuthzError, atLeast, requireMember, requireSession } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

// Who is calling an API route.
//
// Until now every route trusted a browser session only, which left workspace
// API keys unusable for anything but being listed — and made a command-line
// client impossible. A caller is now either a signed-in user or a workspace
// key, and routes ask for what they need through the `requireCaller*` helpers
// instead of reaching for the session directly.
//
// A key is deliberately weaker than its creator: it is scoped to one workspace
// and acts as an EDITOR there. It can read and write prompts and generate code;
// it can never manage members or mint more keys. Those routes still call
// `requireMember`, which needs a session, so a key presenting itself there gets
// 401 and no path to privilege escalation.

export type Caller =
  | { kind: "session"; userId: string }
  // `userId` is the key's creator, used to attribute writes. Null for keys
  // minted before that was recorded.
  | { kind: "key"; keyId: string; workspaceId: string; userId: string | null };

/** The key's role in its own workspace. Read and write, never administration. */
const KEY_ROLE: WorkspaceRole = "EDITOR";

/**
 * True when the request carries a bearer key rather than a cookie.
 *
 * Routes check this before their origin guard: cross-site request forgery is a
 * browser problem, because browsers attach cookies automatically. Nothing
 * attaches an `Authorization` header on a user's behalf, so a key-authenticated
 * request has nothing to forge and no Origin header to offer.
 */
export function usesBearerKey(request: Request): boolean {
  return bearerToken(request) !== null;
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme.toLowerCase() !== "bearer") return null;
  const token = rest.join("");
  return token.startsWith(KEY_PREFIX) ? token : null;
}

/** Identify the caller, by key when one is presented and by session otherwise. */
export async function requireCaller(request: Request): Promise<Caller> {
  const token = bearerToken(request);
  if (!token) {
    const session = await requireSession();
    return { kind: "session", userId: session.user.id };
  }

  // Looked up by hash rather than scanned: the column is unique and indexed, so
  // this is one probe. `verifyApiKey` then confirms in constant time.
  const record = await prisma.apiKey.findUnique({
    where: { hashedKey: hashKey(token) },
    select: {
      id: true,
      hashedKey: true,
      workspaceId: true,
      createdById: true,
      revokedAt: true,
      lastUsedAt: true,
    },
  });

  if (!record || !verifyApiKey(token, record.hashedKey)) {
    throw new AuthzError(401, "API key is not valid.");
  }
  if (record.revokedAt) throw new AuthzError(401, "API key has been revoked.");

  await touchKey(record.id, record.lastUsedAt);

  return {
    kind: "key",
    keyId: record.id,
    workspaceId: record.workspaceId,
    userId: record.createdById,
  };
}

/**
 * Record that a key was used, but not on every single request: a `pops log`
 * that reads three endpoints should not cost three writes. A minute of
 * resolution is plenty for "when was this key last used?".
 */
async function touchKey(id: string, lastUsedAt: Date | null): Promise<void> {
  if (lastUsedAt && Date.now() - lastUsedAt.getTime() < 60_000) return;
  await prisma.apiKey.update({ where: { id }, data: { lastUsedAt: new Date() } });
}

/** Assert the caller may act on `workspaceId` with at least `minimum`. */
export async function requireCallerWorkspace(
  request: Request,
  workspaceId: string,
  minimum: WorkspaceRole = "VIEWER",
): Promise<{ caller: Caller; role: WorkspaceRole }> {
  const caller = await requireCaller(request);

  if (caller.kind === "key") {
    // A key that names another workspace is told the workspace is missing, the
    // same answer a non-member gets, so a key cannot probe for other ids.
    if (caller.workspaceId !== workspaceId) {
      throw new AuthzError(404, "Workspace not found.");
    }
    if (!atLeast(KEY_ROLE, minimum)) {
      throw new AuthzError(403, `An API key cannot perform this action; it acts as ${KEY_ROLE}.`);
    }
    return { caller, role: KEY_ROLE };
  }

  const { role } = await requireMember(workspaceId, minimum);
  return { caller, role };
}

/**
 * Assert the caller may act on `promptId`, and hand back its workspace.
 *
 * Authentication happens before the lookup, for the same reason it does in
 * `requirePromptMember`: resolving the prompt first would answer "does this id
 * exist?" for an anonymous caller, since a missing prompt answers 404 where a
 * real one answers 401.
 */
export async function requireCallerPrompt(
  request: Request,
  promptId: string,
  minimum: WorkspaceRole = "VIEWER",
): Promise<{ caller: Caller; role: WorkspaceRole; workspaceId: string }> {
  const caller = await requireCaller(request);

  const prompt = await prisma.prompt.findUnique({
    where: { id: promptId },
    select: { workspaceId: true },
  });
  if (!prompt) throw new AuthzError(404, "Prompt not found.");

  if (caller.kind === "key") {
    if (caller.workspaceId !== prompt.workspaceId) {
      throw new AuthzError(404, "Prompt not found.");
    }
    if (!atLeast(KEY_ROLE, minimum)) {
      throw new AuthzError(403, `An API key cannot perform this action; it acts as ${KEY_ROLE}.`);
    }
    return { caller, role: KEY_ROLE, workspaceId: prompt.workspaceId };
  }

  const { role } = await requireMember(prompt.workspaceId, minimum);
  return { caller, role, workspaceId: prompt.workspaceId };
}

/** Author for records that keep one optionally — versions, code commits. */
export function authorIdFor(caller: Caller): string | null {
  return caller.userId;
}

/**
 * Author for records that require one, such as a new prompt. A key with no
 * creator on record cannot satisfy that, and says so plainly rather than
 * attributing the work to someone arbitrary.
 */
export function requireAuthorId(caller: Caller): string {
  if (caller.userId) return caller.userId;
  throw new AuthzError(
    403,
    "This API key has no creator on record, so it cannot create a prompt. Create a new key and use that.",
  );
}
