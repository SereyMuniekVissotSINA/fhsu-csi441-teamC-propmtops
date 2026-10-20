import { NextResponse } from "next/server";

import { failure, invalid, readJson } from "@/lib/api";
import { requireCaller, requireCallerWorkspace, requireAuthorId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { createPromptSchema } from "@/lib/validations";

// Prompts are workspace-scoped: you see the prompts in workspaces you belong
// to, and nothing else.
export async function GET(request: Request) {
  try {
    const caller = await requireCaller(request);
    const workspaceId = new URL(request.url).searchParams.get("workspaceId");

    // Scoping to one workspace still goes through the caller check, so a
    // guessed id cannot be used to read someone else's prompts.
    if (workspaceId) await requireCallerWorkspace(request, workspaceId);

    // A key sees exactly its own workspace; a session sees every workspace it
    // belongs to.
    const scope =
      caller.kind === "key"
        ? { workspaceId: caller.workspaceId }
        : { workspace: { members: { some: { userId: caller.userId } } } };

    const prompts = await prisma.prompt.findMany({
      where: workspaceId ? { workspaceId } : scope,
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: {
        author: { select: { id: true, name: true, image: true } },
        workspace: { select: { id: true, name: true, slug: true } },
        // The newest version is what the list previews.
        versions: { orderBy: { createdAt: "desc" }, take: 1 },
        _count: { select: { versions: true } },
      },
    });

    return NextResponse.json(prompts);
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const parsed = createPromptSchema.safeParse(await readJson(request));
    if (!parsed.success) return invalid(parsed.error);

    const { workspaceId, title, body, tags } = parsed.data;
    const { caller } = await requireCallerWorkspace(request, workspaceId, "EDITOR");
    const authorId = requireAuthorId(caller);

    // A prompt and its first version are created together: a prompt with no
    // versions would have nothing to render.
    const prompt = await prisma.prompt.create({
      data: {
        workspaceId,
        authorId,
        title,
        versions: {
          create: {
            title,
            body,
            tags,
            note: "Initial version",
            authorId,
          },
        },
      },
      include: { versions: true },
    });

    return NextResponse.json(prompt, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
