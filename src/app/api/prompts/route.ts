import { NextResponse } from "next/server";

import { failure, invalid, readJson } from "@/lib/api";
import { requireMember, requireSession } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { createPromptSchema } from "@/lib/validations";

// Prompts are workspace-scoped: you see the prompts in workspaces you belong
// to, and nothing else.
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const workspaceId = new URL(request.url).searchParams.get("workspaceId");

    // Scoping to one workspace still goes through requireMember, so a guessed
    // id cannot be used to read someone else's prompts.
    if (workspaceId) await requireMember(workspaceId);

    const prompts = await prisma.prompt.findMany({
      where: workspaceId
        ? { workspaceId }
        : { workspace: { members: { some: { userId: session.user.id } } } },
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
    const { session } = await requireMember(workspaceId, "EDITOR");

    // A prompt and its first version are created together: a prompt with no
    // versions would have nothing to render.
    const prompt = await prisma.prompt.create({
      data: {
        workspaceId,
        authorId: session.user.id,
        title,
        versions: {
          create: {
            title,
            body,
            tags,
            note: "Initial version",
            authorId: session.user.id,
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
