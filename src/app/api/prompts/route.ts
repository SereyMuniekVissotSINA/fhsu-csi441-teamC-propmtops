import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { promptSchema } from "@/lib/validations";

// Reference route showing the auth + Prisma + zod wiring end to end.
export async function GET() {
  const prompts = await prisma.prompt.findMany({
    orderBy: { createdAt: "desc" },
    include: { author: { select: { id: true, name: true, image: true } } },
    take: 50,
  });

  return NextResponse.json(prompts);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = promptSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: z.treeifyError(parsed.error) },
      { status: 422 },
    );
  }

  const prompt = await prisma.prompt.create({
    data: { ...parsed.data, authorId: session.user.id },
  });

  return NextResponse.json(prompt, { status: 201 });
}
