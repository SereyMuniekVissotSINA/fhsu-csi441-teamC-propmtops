import { NextResponse } from "next/server";

import { failure, invalid, readJson } from "@/lib/api";
import { generateApiKey } from "@/lib/api-keys";
import { AuthzError, requireMember } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { createApiKeySchema } from "@/lib/validations";

export async function GET(_request: Request, { params }: RouteContext<"/api/workspaces/[id]/keys">) {
  try {
    const { id } = await params;
    await requireMember(id, "OWNER");

    // `hashedKey` is deliberately never selected — there is nothing useful a
    // caller can do with it, and it should not travel over the wire.
    const keys = await prisma.apiKey.findMany({
      where: { workspaceId: id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        prefix: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json(keys);
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, { params }: RouteContext<"/api/workspaces/[id]/keys">) {
  try {
    const { id } = await params;
    await requireMember(id, "OWNER");

    const parsed = createApiKeySchema.safeParse(await readJson(request));
    if (!parsed.success) return invalid(parsed.error);

    const { key, hashedKey, prefix } = generateApiKey();

    const created = await prisma.apiKey.create({
      data: { workspaceId: id, name: parsed.data.name, hashedKey, prefix },
      select: { id: true, name: true, prefix: true, createdAt: true },
    });

    // The only time the plaintext is ever returned. It cannot be recovered
    // later, so the UI has to make the user copy it now.
    return NextResponse.json({ ...created, key }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/workspaces/[id]/keys">) {
  try {
    const { id } = await params;
    await requireMember(id, "OWNER");

    const keyId = new URL(request.url).searchParams.get("keyId");
    if (!keyId) throw new AuthzError(404, "Which key? Pass ?keyId=.");

    // Revoked rather than deleted, so an audit of past keys survives.
    const { count } = await prisma.apiKey.updateMany({
      where: { id: keyId, workspaceId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new AuthzError(404, "Key not found or already revoked.");

    return NextResponse.json({ revoked: keyId });
  } catch (error) {
    return failure(error);
  }
}
