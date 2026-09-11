import { NextResponse } from "next/server";

import { failure, invalid, readJson } from "@/lib/api";
import { AuthzError, requireMember, wouldOrphanWorkspace } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { memberSchema, updateMemberSchema } from "@/lib/validations";

// Only owners manage membership — same rule the demo enforces in
// `src/lib/demo-accounts.ts`.

export async function POST(request: Request, { params }: RouteContext<"/api/workspaces/[id]/members">) {
  try {
    const { id } = await params;
    await requireMember(id, "OWNER");

    const parsed = memberSchema.safeParse(await readJson(request));
    if (!parsed.success) return invalid(parsed.error);

    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      select: { id: true },
    });
    // Invitations for people without accounts would need an email flow; for now
    // the person has to have registered.
    if (!user) throw new AuthzError(404, "No user with that email address.");

    const membership = await prisma.membership.upsert({
      where: { userId_workspaceId: { userId: user.id, workspaceId: id } },
      update: { role: parsed.data.role },
      create: { userId: user.id, workspaceId: id, role: parsed.data.role },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
    });

    return NextResponse.json(membership, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/workspaces/[id]/members">) {
  try {
    const { id } = await params;
    await requireMember(id, "OWNER");

    const parsed = updateMemberSchema.safeParse(await readJson(request));
    if (!parsed.success) return invalid(parsed.error);
    const { userId, role } = parsed.data;

    const members = await prisma.membership.findMany({
      where: { workspaceId: id },
      select: { userId: true, role: true },
    });

    if (!members.some((m) => m.userId === userId)) {
      throw new AuthzError(404, "That person is not a member of this workspace.");
    }

    // A workspace with no owner can never be managed again, so this is refused
    // rather than warned about.
    if (wouldOrphanWorkspace(members, userId, role)) {
      throw new AuthzError(
        403,
        "Assign another owner before removing or demoting the last owner.",
      );
    }

    if (role === null) {
      await prisma.membership.delete({
        where: { userId_workspaceId: { userId, workspaceId: id } },
      });
      return NextResponse.json({ removed: userId });
    }

    const membership = await prisma.membership.update({
      where: { userId_workspaceId: { userId, workspaceId: id } },
      data: { role },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
    });

    return NextResponse.json(membership);
  } catch (error) {
    return failure(error);
  }
}
