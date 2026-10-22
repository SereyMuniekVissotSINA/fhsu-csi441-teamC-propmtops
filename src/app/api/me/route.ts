import { NextResponse } from "next/server";

import { failure } from "@/lib/api";
import { requireCaller } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

// Who am I, and what can I reach?
//
// The CLI calls this to confirm a key works before doing anything with it, so
// the answer names the workspace a key is scoped to and the user its writes are
// attributed to.
export async function GET(request: Request) {
  try {
    const caller = await requireCaller(request);

    const user = caller.userId
      ? await prisma.user.findUnique({
          where: { id: caller.userId },
          select: { id: true, name: true, email: true },
        })
      : null;

    if (caller.kind === "session") {
      const workspaces = await prisma.membership.findMany({
        where: { userId: caller.userId },
        orderBy: { workspace: { createdAt: "asc" } },
        select: { role: true, workspace: { select: { id: true, name: true, slug: true } } },
      });
      return NextResponse.json({ authenticatedAs: "session", user, workspaces });
    }

    const key = await prisma.apiKey.findUnique({
      where: { id: caller.keyId },
      select: {
        name: true,
        prefix: true,
        lastUsedAt: true,
        workspace: { select: { id: true, name: true, slug: true } },
      },
    });

    return NextResponse.json({
      authenticatedAs: "apiKey",
      // Writes are attributed to the key's creator; null means this key cannot
      // create a prompt.
      user,
      key: key && { name: key.name, prefix: key.prefix, lastUsedAt: key.lastUsedAt },
      // A key reaches exactly one workspace, and acts as an editor inside it.
      workspaces: key ? [{ role: "EDITOR", workspace: key.workspace }] : [],
    });
  } catch (error) {
    return failure(error);
  }
}
