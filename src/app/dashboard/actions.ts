"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { signOut } from "@/auth";
import { AuthzError, requireMember, requireSession } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import {
  createPromptSchema,
  createWorkspaceSchema,
  updatePromptSchema,
} from "@/lib/validations";

export type FormState = { error?: string };

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

function messageOf(error: unknown) {
  if (error instanceof AuthzError) return error.message;
  console.error(error);
  return "Something went wrong. Please try again.";
}

export async function createWorkspaceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createWorkspaceSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a workspace name." };
  }

  let slug: string;
  try {
    const session = await requireSession();
    const workspace = await prisma.workspace.create({
      data: {
        name: parsed.data.name,
        slug: await uniqueSlug(parsed.data.name),
        members: { create: { userId: session.user.id, role: "OWNER" } },
      },
    });
    slug = workspace.slug;
  } catch (error) {
    return { error: messageOf(error) };
  }

  // Outside the try: redirect signals itself by throwing, and catching it here
  // would swallow the navigation.
  revalidatePath("/dashboard");
  redirect(`/dashboard?workspace=${slug}`);
}

export async function createPromptAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createPromptSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    title: formData.get("title"),
    body: formData.get("body"),
    tags: formData.get("tags") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  let promptId: string;
  try {
    const { workspaceId, title, body, tags } = parsed.data;
    const { session } = await requireMember(workspaceId, "EDITOR");

    const prompt = await prisma.prompt.create({
      data: {
        workspaceId,
        authorId: session.user.id,
        title,
        versions: {
          create: { title, body, tags, note: "Initial version", authorId: session.user.id },
        },
      },
    });
    promptId = prompt.id;
  } catch (error) {
    return { error: messageOf(error) };
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard/prompts/${promptId}`);
}

export async function savePromptAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get("id") ?? "");

  const parsed = updatePromptSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
    tags: formData.get("tags") ?? "",
    note: formData.get("note") || "Updated prompt",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  try {
    const prompt = await prisma.prompt.findUnique({
      where: { id },
      select: { workspaceId: true },
    });
    if (!prompt) throw new AuthzError(404, "Prompt not found.");

    const { session } = await requireMember(prompt.workspaceId, "EDITOR");
    const { title, body, tags, note } = parsed.data;

    // Append a version rather than overwrite — that is what makes history work.
    await prisma.prompt.update({
      where: { id },
      data: {
        title,
        versions: { create: { title, body, tags, note, authorId: session.user.id } },
      },
    });
  } catch (error) {
    return { error: messageOf(error) };
  }

  revalidatePath(`/dashboard/prompts/${id}`);
  revalidatePath("/dashboard");
  return {};
}

async function uniqueSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "workspace";

  for (let suffix = 0; ; suffix++) {
    const slug = suffix === 0 ? base : `${base}-${suffix}`;
    const taken = await prisma.workspace.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!taken) return slug;
  }
}
