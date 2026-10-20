import { NextResponse } from "next/server";

import { failure, invalid, readJson } from "@/lib/api";
import { authorIdFor, requireCallerPrompt } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { updatePromptSchema } from "@/lib/validations";

export async function GET(request: Request, { params }: RouteContext<"/api/prompts/[id]">) {
  try {
    const { id } = await params;
    await requireCallerPrompt(request, id);

    const prompt = await prisma.prompt.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, name: true, image: true } },
        workspace: { select: { id: true, name: true, slug: true } },
        versions: {
          orderBy: { createdAt: "desc" },
          include: { author: { select: { id: true, name: true } } },
        },
      },
    });

    return NextResponse.json(prompt);
  } catch (error) {
    return failure(error);
  }
}

// Editing appends a version rather than mutating the current one — that is what
// makes the history view possible.
export async function PATCH(request: Request, { params }: RouteContext<"/api/prompts/[id]">) {
  try {
    const { id } = await params;
    const { caller } = await requireCallerPrompt(request, id, "EDITOR");

    const parsed = updatePromptSchema.safeParse(await readJson(request));
    if (!parsed.success) return invalid(parsed.error);

    const { title, body, tags, note } = parsed.data;

    const prompt = await prisma.prompt.update({
      where: { id },
      data: {
        // Keep the denormalized title in step with the newest version.
        title,
        versions: { create: { title, body, tags, note, authorId: authorIdFor(caller) } },
      },
      include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } },
    });

    return NextResponse.json(prompt);
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/prompts/[id]">) {
  try {
    const { id } = await params;
    await requireCallerPrompt(request, id, "EDITOR");

    // Versions cascade with the prompt (see onDelete in schema.prisma).
    await prisma.prompt.delete({ where: { id } });
    return NextResponse.json({ deleted: id });
  } catch (error) {
    return failure(error);
  }
}
