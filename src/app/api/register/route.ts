import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { registerSchema } from "@/lib/validations";

export async function POST(request: Request) {
  const parsed = registerSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: z.treeifyError(parsed.error) },
      { status: 422 },
    );
  }

  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  }

  const user = await prisma.user.create({
    data: { name, email, passwordHash: await bcrypt.hash(password, 10) },
    select: { id: true, name: true, email: true },
  });

  return NextResponse.json(user, { status: 201 });
}
