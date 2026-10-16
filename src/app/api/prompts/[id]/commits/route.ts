import { NextResponse } from "next/server";

import { failure } from "@/lib/api";
import { requireCallerPrompt } from "@/lib/api-auth";
import { commitStats } from "@/lib/code-commits";
import { prisma } from "@/lib/prisma";

// The commit log for one prompt, newest first — file paths and change counts
// only. Fetch a single commit for contents and the full model response.
//
// Viewers can read the log: it is history, not an action.

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireCallerPrompt(request, id);

    const commits = await prisma.codeCommit.findMany({
      where: { promptId: id },
      orderBy: { sequence: "desc" },
      include: {
        author: { select: { name: true } },
        files: {
          orderBy: { path: "asc" },
          select: {
            path: true,
            hash: true,
            language: true,
            change: true,
            added: true,
            removed: true,
          },
        },
      },
    });

    return NextResponse.json({
      commits: commits.map((commit) => ({
        id: commit.id,
        sequence: commit.sequence,
        message: commit.message,
        parentId: commit.parentId,
        promptVersionId: commit.promptVersionId,
        model: commit.model,
        elapsedMs: commit.elapsedMs,
        inputTokens: commit.inputTokens,
        outputTokens: commit.outputTokens,
        incomplete: commit.incomplete,
        createdAt: commit.createdAt.toISOString(),
        authorName: commit.author?.name ?? null,
        stats: commitStats(commit.files),
        files: commit.files,
      })),
    });
  } catch (error) {
    return failure(error);
  }
}
