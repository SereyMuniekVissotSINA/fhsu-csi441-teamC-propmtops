import { NextResponse } from "next/server";

import { cleanSnapshotName, snapshotSlug } from "@/lib/agent-runs";
import { failure, invalid, readJson } from "@/lib/api";
import { authorIdFor, requireCaller, requireCallerWorkspace } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { createSnapshotSchema } from "@/lib/validations";

// Snapshots: the branches a workspace holds.
//
// A snapshot is one line of work — the thing `pops snapshot` names before an
// agent starts, and the thing runs are filed under afterwards. It belongs to a
// workspace and to nothing else, which is why creating one takes a workspace
// id rather than inventing a home for it.
//
// What the server keeps is the record of the branch. The baseline itself — the
// copy of the working tree a push diffs against — stays in `.pops/` on the
// machine that took it.

export async function GET(request: Request) {
  try {
    const caller = await requireCaller(request);
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId");
    // Archived branches are out of the way by default: that is what archiving
    // is for. `?archived=1` is how the website offers to bring one back.
    const archived = url.searchParams.get("archived") === "1";

    if (workspaceId) await requireCallerWorkspace(request, workspaceId);

    const scope =
      caller.kind === "key"
        ? { workspaceId: caller.workspaceId }
        : { workspace: { members: { some: { userId: caller.userId } } } };

    const snapshots = await prisma.snapshot.findMany({
      where: {
        ...(workspaceId ? { workspaceId } : scope),
        ...(archived ? {} : { archivedAt: null }),
      },
      // Most recently baselined first, falling back to creation: the branch
      // someone is working in now is the one they want at the top.
      orderBy: [{ baselinedAt: "desc" }, { createdAt: "desc" }],
      include: {
        author: { select: { name: true } },
        workspace: { select: { id: true, name: true, slug: true } },
        _count: { select: { runs: true } },
      },
    });

    return NextResponse.json({
      snapshots: snapshots.map((snapshot) => ({
        id: snapshot.id,
        workspace: snapshot.workspace,
        name: snapshot.name,
        slug: snapshot.slug,
        runs: snapshot._count.runs,
        baselinedAt: snapshot.baselinedAt?.toISOString() ?? null,
        archivedAt: snapshot.archivedAt?.toISOString() ?? null,
        authorName: snapshot.author?.name ?? null,
        createdAt: snapshot.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    // Identified before the body is read, so an anonymous request gets 401
    // rather than a validation reply telling it what the route accepts.
    await requireCaller(request);

    const parsed = createSnapshotSchema.safeParse(await readJson(request));
    if (!parsed.success) return invalid(parsed.error);

    const { workspaceId, baselinedAt } = parsed.data;
    const { caller } = await requireCallerWorkspace(request, workspaceId, "EDITOR");

    const name = cleanSnapshotName(parsed.data.name);
    // A name that slugifies to nothing — punctuation only — could not be told
    // apart from any other such name, so it is refused rather than stored.
    if (!name) return unusableName(parsed.data.name);
    const slug = snapshotSlug(name);

    // Taking a baseline again under a name the workspace already has is the
    // same branch, not a second one, so this is an upsert rather than a
    // create that collides. It also un-archives: baselining a retired branch
    // is how someone picks that line of work back up.
    const snapshot = await prisma.snapshot.upsert({
      where: { workspaceId_slug: { workspaceId, slug } },
      create: {
        workspaceId,
        authorId: authorIdFor(caller),
        name,
        slug,
        baselinedAt: baselinedAt ? new Date(baselinedAt) : null,
      },
      update: {
        // The name as last typed wins, so fixing the capitalisation of a
        // branch is just taking its baseline again.
        name,
        ...(baselinedAt ? { baselinedAt: new Date(baselinedAt), archivedAt: null } : {}),
      },
      include: { _count: { select: { runs: true } } },
    });

    return NextResponse.json(
      {
        id: snapshot.id,
        name: snapshot.name,
        slug: snapshot.slug,
        runs: snapshot._count.runs,
        baselinedAt: snapshot.baselinedAt?.toISOString() ?? null,
        archivedAt: snapshot.archivedAt?.toISOString() ?? null,
        createdAt: snapshot.createdAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (error) {
    return failure(error);
  }
}

/** 422, the same shape `invalid()` answers with, for a name Zod cannot judge. */
function unusableName(raw: string) {
  return NextResponse.json(
    {
      error: `"${raw}" is not a usable snapshot name. Use letters or numbers, like "auth refactor".`,
    },
    { status: 422 },
  );
}
