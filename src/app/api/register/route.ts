import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { failure, readJson } from "@/lib/api";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { registerSchema } from "@/lib/validations";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  try {
    const parsed = registerSchema.safeParse(await readJson(request));
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

    // A new account gets a personal workspace immediately: without one there is
    // nowhere to put a prompt, and the dashboard would open empty and dead-ended.
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash: await bcrypt.hash(password, 10),
        memberships: {
          create: {
            role: "OWNER",
            workspace: {
              create: { name: `${name}'s workspace`, slug: `workspace-${randomUUID()}` },
            },
          },
        },
      },
      select: { id: true, name: true, email: true },
    });

    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }
    return failure(error);
  }
}
