import { NextResponse } from "next/server";

import { cleanSnapshotName, snapshotSlug } from "@/lib/agent-runs";
import { failure, invalid, readJson } from "@/lib/api";
import { requireCallerSnapshot } from "@/lib/api-auth";
import { AuthzError } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { updateSnapshotSchema } from "@/lib/validations";

// One branch: rename it, retire it, bring it back, or delete it outright.

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { workspaceId } = await requireCallerSnapshot(request, id, "EDITOR");

    const parsed = updateSnapshotSchema.safeParse(await readJson(request));
    if (!parsed.success) return invalid(parsed.error);

    let data: { name?: string; slug?: string; archivedAt?: Date | null; baselinedAt?: Date };

    if ("action" in parsed.data) {
      data =
        parsed.data.action === "archive" ? { archivedAt: new Date() } : { archivedAt: null };
    } else if ("baselinedAt" in parsed.data) {
      // Reported by the CLI when it re-baselines a branch it already knows.
      data = { baselinedAt: new Date(parsed.data.baselinedAt), archivedAt: null };
    } else {
      const name = cleanSnapshotName(parsed.data.name);
      if (!name) return unusableName(parsed.data.name);
      const slug = snapshotSlug(name);
      // The slug moves with the name, so a rename has to check the workspace
      // does not already have that branch under another id.
      const clash = await prisma.snapshot.findUnique({
        where: { workspaceId_slug: { workspaceId, slug } },
        select: { id: true, name: true },
      });
      if (clash && clash.id !== id) {
        throw new AuthzError(409, `This workspace already has a snapshot called "${clash.name}".`);
      }
      data = { name, slug };
    }

    const snapshot = await prisma.snapshot.update({
      where: { id },
      data,
      include: { _count: { select: { runs: true } } },
    });

    // Runs keep the name they were pushed under, except on a rename: there the
    // denormalized copy is rewritten so the log does not show two names for
    // one branch. The same thing `Prompt.title` does when a version lands.
    if (data.name && data.slug) {
      await prisma.agentRun.updateMany({
        where: { snapshotId: id },
        data: { category: data.name, categorySlug: data.slug },
      });
    }

    return NextResponse.json({
      id: snapshot.id,
      name: snapshot.name,
      slug: snapshot.slug,
      runs: snapshot._count.runs,
      baselinedAt: snapshot.baselinedAt?.toISOString() ?? null,
      archivedAt: snapshot.archivedAt?.toISOString() ?? null,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireCallerSnapshot(request, id, "EDITOR");

    // A branch with runs under it is not deletable, and the schema says so too
    // (`onDelete: Restrict`). Those runs are the record of what an agent did to
    // someone's files; retiring the branch is how a finished line of work goes
    // away without taking its history with it.
    const runs = await prisma.agentRun.count({ where: { snapshotId: id } });
    if (runs > 0) {
      throw new AuthzError(
        409,
        `This snapshot has ${runs} run${runs === 1 ? "" : "s"} filed under it, which are the record of what an agent changed. Archive it instead.`,
      );
    }

    await prisma.snapshot.delete({ where: { id } });
    return NextResponse.json({ id, deleted: true });
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
