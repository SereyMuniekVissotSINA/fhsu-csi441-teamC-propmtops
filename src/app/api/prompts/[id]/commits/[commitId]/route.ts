import { NextResponse } from "next/server";

import { failure } from "@/lib/api";
import { requireCallerPrompt } from "@/lib/api-auth";
import { AuthzError } from "@/lib/authz";
import { commitStats } from "@/lib/code-commits";
import { prisma } from "@/lib/prisma";

// One commit in full: every file's contents, the exact prompt that was sent,
// and the raw model response, so a generation can be read back or reproduced.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; commitId: string }> },
) {
  try {
    const { id, commitId } = await params;
    await requireCallerPrompt(request, id);

    const commit = await prisma.codeCommit.findFirst({
      // Scoped by promptId as well: a commit id from another prompt must not
      // resolve just because the caller can read this one.
      where: { id: commitId, promptId: id },
      include: {
        author: { select: { name: true } },
        promptVersion: { select: { id: true, title: true, note: true } },
        files: { orderBy: { path: "asc" } },
      },
    });
    if (!commit) throw new AuthzError(404, "Commit not found.");

    return NextResponse.json({
      id: commit.id,
      sequence: commit.sequence,
      message: commit.message,
      parentId: commit.parentId,
      promptVersion: commit.promptVersion,
      input: commit.input,
      output: commit.output,
      model: commit.model,
      elapsedMs: commit.elapsedMs,
      inputTokens: commit.inputTokens,
      outputTokens: commit.outputTokens,
      incomplete: commit.incomplete,
      createdAt: commit.createdAt.toISOString(),
      authorName: commit.author?.name ?? null,
      stats: commitStats(commit.files),
      files: commit.files,
    });
  } catch (error) {
    return failure(error);
  }
}
