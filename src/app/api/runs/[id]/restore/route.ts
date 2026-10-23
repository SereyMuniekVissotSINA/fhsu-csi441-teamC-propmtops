import { NextResponse } from "next/server";

import { failure, invalid, readJson } from "@/lib/api";
import { requireCallerRun } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { restoreRunSchema } from "@/lib/validations";

// The restore handshake.
//
// A web page cannot write to someone's working directory, and nothing in this
// project should be able to reach into a developer's filesystem on its own. So
// undoing a run is two steps with the operator in the middle: the website
// records that an undo was asked for, and `pops restore` — running on the
// machine that owns the files, under the key for this workspace — picks the
// request up, applies it locally, and reports back.
//
// None of the three actions edits the run itself. They stamp status on it, the
// way ApiKey.lastUsedAt does: the run stays exactly as it was recorded, so the
// log still says what the agent did even after the change has been undone.

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // EDITOR either way: asking for an undo and performing one are both writes
    // to the project, so a viewer can read the diff and nothing more.
    const { caller } = await requireCallerRun(request, id, "EDITOR");

    const parsed = restoreRunSchema.safeParse(await readJson(request));
    if (!parsed.success) return invalid(parsed.error);

    const now = new Date();
    const data =
      parsed.data.action === "request"
        ? {
            restoreRequestedAt: now,
            restoreRequestedById: caller.userId,
            // Asking again after an undo was already applied is a fresh
            // request, not a stale one, so the old stamp is cleared.
            restoredAt: null,
          }
        : parsed.data.action === "cancel"
          ? { restoreRequestedAt: null, restoreRequestedById: null }
          : { restoredAt: now, restoreRequestedAt: null };

    const run = await prisma.agentRun.update({
      where: { id },
      data,
      select: {
        id: true,
        sequence: true,
        restoreRequestedAt: true,
        restoredAt: true,
      },
    });

    return NextResponse.json({
      id: run.id,
      sequence: run.sequence,
      action: parsed.data.action,
      restoreRequestedAt: run.restoreRequestedAt?.toISOString() ?? null,
      restoredAt: run.restoredAt?.toISOString() ?? null,
    });
  } catch (error) {
    return failure(error);
  }
}
