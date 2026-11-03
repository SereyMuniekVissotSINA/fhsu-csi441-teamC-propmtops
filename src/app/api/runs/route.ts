import { NextResponse } from "next/server";

import {
  MAX_RUN_TOTAL_CHARS,
  snapshotSlug,
  classifyLocalChanges,
  cleanSnapshotName,
  describeRun,
  runCharCount,
  runStats,
  type RunFile,
} from "@/lib/agent-runs";
import { failure, invalid, readJson } from "@/lib/api";
import { authorIdFor, requireCaller, requireCallerWorkspace } from "@/lib/api-auth";
import { AuthzError } from "@/lib/authz";
import { fileHash } from "@/lib/code-commits";
import { prisma } from "@/lib/prisma";
import { createRunSchema } from "@/lib/validations";

// Agent runs for a workspace: what an agent changed on someone's disk.
//
// This is where the `pops push` half of the product lands. Unlike the generate
// route next door, nothing here reaches a model — the work already happened
// locally — so it is not development-only and a deployed instance can collect
// runs from a laptop and show them back.

export async function GET(request: Request) {
  try {
    const caller = await requireCaller(request);
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId");
    // The CLI's `restore --watch` asks for exactly the runs the website has
    // asked to undo, so it does not have to page through the whole log.
    const pendingRestore = url.searchParams.get("pendingRestore") === "1";
    // Slugged here as well as by the caller, so `?category=Auth Refactor` and
    // `?category=auth-refactor` reach the same container.
    const category = url.searchParams.get("category");
    const slug = category === null ? null : snapshotSlug(category);
    // By branch id, which is what the snapshot pages link with. The slug
    // filter stays for the chips and for a name typed by hand.
    const snapshotId = url.searchParams.get("snapshotId");

    // Scoping to one workspace still goes through the caller check, so a
    // guessed id cannot be used to read someone else's runs.
    if (workspaceId) await requireCallerWorkspace(request, workspaceId);

    const scope =
      caller.kind === "key"
        ? { workspaceId: caller.workspaceId }
        : { workspace: { members: { some: { userId: caller.userId } } } };

    const runs = await prisma.agentRun.findMany({
      where: {
        ...(workspaceId ? { workspaceId } : scope),
        ...(pendingRestore ? { restoreRequestedAt: { not: null }, restoredAt: null } : {}),
        ...(snapshotId ? { snapshotId } : {}),
        ...(slug === null ? {} : { categorySlug: slug }),
      },
      // Newest first across the whole workspace, deliberately not grouped by
      // category: this page is capped at 50, and ordering by category would
      // drop the newest runs of a late-alphabet name off the end. Callers that
      // show containers group what they are given, which also puts the most
      // recently worked-on category first.
      orderBy: { sequence: "desc" },
      take: 50,
      include: {
        author: { select: { name: true } },
        restoreRequestedBy: { select: { name: true } },
        workspace: { select: { id: true, name: true, slug: true } },
        // The list shows paths and counts; contents come from the detail route.
        files: {
          orderBy: { path: "asc" },
          select: {
            path: true,
            language: true,
            change: true,
            added: true,
            removed: true,
            beforeHash: true,
            afterHash: true,
          },
        },
      },
    });

    return NextResponse.json({
      runs: runs.map((run) => ({
        id: run.id,
        sequence: run.sequence,
        workspace: run.workspace,
        snapshotId: run.snapshotId,
        category: run.category,
        categorySlug: run.categorySlug,
        baselineAt: run.baselineAt?.toISOString() ?? null,
        agent: run.agent,
        root: run.root,
        prompt: run.prompt,
        summary: describeRun(run.files),
        stats: runStats(run.files),
        authorName: run.author?.name ?? null,
        restoreRequestedAt: run.restoreRequestedAt?.toISOString() ?? null,
        restoreRequestedByName: run.restoreRequestedBy?.name ?? null,
        restoredAt: run.restoredAt?.toISOString() ?? null,
        createdAt: run.createdAt.toISOString(),
        files: run.files,
      })),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    // Identified before the body is read, for the usual reason and one more:
    // a run carries megabytes of file contents, and parsing that for a caller
    // who turns out to be nobody is work done on an anonymous request's behalf.
    await requireCaller(request);

    const parsed = createRunSchema.safeParse(await readJson(request));
    if (!parsed.success) return invalid(parsed.error);

    const { workspaceId, agent, root, prompt, response, toolEvents, files } = parsed.data;
    const { caller } = await requireCallerWorkspace(request, workspaceId, "EDITOR");

    // Which branch this run belongs to. `snapshotId` is what the CLI sends
    // once it has created the snapshot; a bare name is accepted so a push from
    // a CLI that predates workspace-owned snapshots still lands somewhere, and
    // it finds or creates the branch by slug rather than filing the run loose.
    const snapshot = await resolveSnapshot(
      workspaceId,
      parsed.data.snapshotId,
      parsed.data.category,
      authorIdFor(caller),
      parsed.data.baselineAt,
    );

    // Classified server-side rather than trusting a status from the client: a
    // stored run must never claim a change its own contents contradict.
    const classified = classifyLocalChanges(files);
    if (classified.length === 0) {
      throw new AuthzError(
        403,
        "Every file in this push is unchanged, so there is no run to record.",
      );
    }
    if (runCharCount(classified) > MAX_RUN_TOTAL_CHARS) {
      return NextResponse.json(
        {
          error: `This run carries more than ${MAX_RUN_TOTAL_CHARS.toLocaleString()} characters of file contents. Narrow the snapshot with a smaller project root.`,
        },
        { status: 413 },
      );
    }

    const run = await appendRun({
      workspaceId,
      authorId: authorIdFor(caller),
      snapshotId: snapshot?.id ?? null,
      // Copied onto the run as it stood at push time, beside the relation.
      category: snapshot?.name ?? "",
      baselineAt: parsed.data.baselineAt ? new Date(parsed.data.baselineAt) : null,
      agent,
      root,
      prompt,
      response,
      toolEvents,
      files: classified,
    });

    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

/**
 * The branch a push belongs to.
 *
 * A snapshot id is checked against the workspace rather than trusted: a key is
 * scoped to one workspace, and a run must never be filed under a branch in
 * somebody else's. A name instead of an id is the older CLI's shape, and is
 * found or created by slug — a push naming its branch is as good as creating
 * it, and better than leaving the run unfiled.
 */
async function resolveSnapshot(
  workspaceId: string,
  snapshotId: string | undefined,
  rawName: string,
  authorId: string | null,
  baselineAt: string | null,
) {
  if (snapshotId) {
    const snapshot = await prisma.snapshot.findUnique({
      where: { id: snapshotId },
      select: { id: true, name: true, workspaceId: true },
    });
    if (!snapshot || snapshot.workspaceId !== workspaceId) {
      throw new AuthzError(404, "Snapshot not found.");
    }
    return snapshot;
  }

  const name = cleanSnapshotName(rawName);
  // No id and no usable name: the push predates snapshots entirely. The run is
  // still worth keeping, and shows as unfiled.
  if (!name) return null;

  return prisma.snapshot.upsert({
    where: { workspaceId_slug: { workspaceId, slug: snapshotSlug(name) } },
    create: {
      workspaceId,
      authorId,
      name,
      slug: snapshotSlug(name),
      baselinedAt: baselineAt ? new Date(baselineAt) : null,
    },
    update: {},
    select: { id: true, name: true, workspaceId: true },
  });
}

/**
 * Append one run.
 *
 * Two pushes finishing together collide on (workspaceId, sequence). Both are
 * real runs, so the loser re-reads the tip and appends behind the winner rather
 * than failing — the same retry the code-commit write uses, and for the same
 * reason.
 */
async function appendRun(input: {
  workspaceId: string;
  authorId: string | null;
  snapshotId: string | null;
  category: string;
  baselineAt: Date | null;
  agent: string;
  root: string;
  prompt: string;
  response: string;
  toolEvents: string;
  files: RunFile[];
}) {
  for (let attempt = 0; ; attempt++) {
    const latest = await prisma.agentRun.findFirst({
      where: { workspaceId: input.workspaceId },
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    });

    try {
      const run = await prisma.agentRun.create({
        data: {
          workspaceId: input.workspaceId,
          authorId: input.authorId,
          // Numbered per workspace, not per category: `r7` stays one run no
          // matter which container it is read from, and a reference a person
          // writes down never becomes ambiguous.
          sequence: (latest?.sequence ?? 0) + 1,
          snapshotId: input.snapshotId,
          category: input.category,
          categorySlug: snapshotSlug(input.category),
          baselineAt: input.baselineAt,
          agent: input.agent,
          root: input.root,
          prompt: input.prompt,
          response: input.response,
          toolEvents: input.toolEvents,
          files: {
            create: input.files.map((file) => ({
              path: file.path,
              before: file.before,
              after: file.after,
              beforeHash: fileHash(file.before),
              afterHash: fileHash(file.after),
              language: file.language,
              change: file.change,
              added: file.added,
              removed: file.removed,
            })),
          },
        },
        include: {
          author: { select: { name: true } },
          files: { orderBy: { path: "asc" } },
        },
      });

      return {
        id: run.id,
        sequence: run.sequence,
        snapshotId: run.snapshotId,
        category: run.category,
        categorySlug: run.categorySlug,
        baselineAt: run.baselineAt?.toISOString() ?? null,
        agent: run.agent,
        root: run.root,
        summary: describeRun(run.files),
        stats: runStats(run.files),
        authorName: run.author?.name ?? null,
        createdAt: run.createdAt.toISOString(),
        files: run.files.map((file) => ({
          path: file.path,
          language: file.language,
          change: file.change,
          added: file.added,
          removed: file.removed,
        })),
      };
    } catch (error) {
      const collided =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "P2002";
      if (!collided || attempt >= 2) {
        if (collided) throw new AuthzError(409, "Another push landed first. Try again.");
        throw error;
      }
    }
  }
}
