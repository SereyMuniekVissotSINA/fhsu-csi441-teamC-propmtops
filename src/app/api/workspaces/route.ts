import { NextResponse } from "next/server";

import { failure, invalid, readJson } from "@/lib/api";
import { requireSession } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { createWorkspaceSchema } from "@/lib/validations";

export async function GET() {
  try {
    const session = await requireSession();

    const workspaces = await prisma.workspace.findMany({
      where: { members: { some: { userId: session.user.id } } },
      orderBy: { createdAt: "asc" },
      include: {
        members: {
          select: {
            role: true,
            user: { select: { id: true, name: true, email: true, image: true } },
          },
        },
        _count: { select: { prompts: true } },
      },
    });

    return NextResponse.json(workspaces);
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();

    const parsed = createWorkspaceSchema.safeParse(await readJson(request));
    if (!parsed.success) return invalid(parsed.error);

    const workspace = await prisma.workspace.create({
      data: {
        name: parsed.data.name,
        slug: await uniqueSlug(parsed.data.name),
        // Whoever creates a workspace owns it, so it always has an owner from
        // the moment it exists.
        members: { create: { userId: session.user.id, role: "OWNER" } },
      },
    });

    return NextResponse.json(workspace, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

async function uniqueSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "workspace";

  // Names are not unique, slugs are. Walk until a free one is found.
  for (let suffix = 0; ; suffix++) {
    const slug = suffix === 0 ? base : `${base}-${suffix}`;
    const taken = await prisma.workspace.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!taken) return slug;
  }
}
