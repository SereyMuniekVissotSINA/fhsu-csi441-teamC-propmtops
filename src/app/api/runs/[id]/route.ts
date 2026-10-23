import { NextResponse } from "next/server";

import { describeRun, runStats } from "@/lib/agent-runs";
import { failure } from "@/lib/api";
import { requireCallerRun } from "@/lib/api-auth";
import { AuthzError } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

// One run in full: both sides of every file it touched.
//
// This is what `pops restore` reads — the `before` contents here are exactly
// what gets written back to disk — so it carries contents where the listing
// carries only counts.

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireCallerRun(request, id);

    const run = await prisma.agentRun.findUnique({
      where: { id },
      include: {
        author: { select: { name: true } },
        restoreRequestedBy: { select: { name: true } },
        workspace: { select: { id: true, name: true, slug: true } },
        files: { orderBy: { path: "asc" } },
      },
    });
    // Authorization resolved the run a moment ago, so this is only reachable if
    // it was deleted in between.
    if (!run) throw new AuthzError(404, "Run not found.");

    return NextResponse.json({
      id: run.id,
      sequence: run.sequence,
      workspace: run.workspace,
      category: run.category,
      categorySlug: run.categorySlug,
      baselineAt: run.baselineAt?.toISOString() ?? null,
      agent: run.agent,
      root: run.root,
      prompt: run.prompt,
      response: run.response,
      toolEvents: run.toolEvents,
      summary: describeRun(run.files),
      stats: runStats(run.files),
      authorName: run.author?.name ?? null,
      restoreRequestedAt: run.restoreRequestedAt?.toISOString() ?? null,
      restoreRequestedByName: run.restoreRequestedBy?.name ?? null,
      restoredAt: run.restoredAt?.toISOString() ?? null,
      createdAt: run.createdAt.toISOString(),
      files: run.files.map((file) => ({
        path: file.path,
        before: file.before,
        after: file.after,
        beforeHash: file.beforeHash,
        afterHash: file.afterHash,
        language: file.language,
        change: file.change,
        added: file.added,
        removed: file.removed,
      })),
    });
  } catch (error) {
    return failure(error);
  }
}
