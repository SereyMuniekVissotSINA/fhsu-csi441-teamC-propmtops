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

/**
 * Delete a prompt outright.
 *
 * This is the one destructive operation in the product, and it is deliberately
 * not an append: a prompt's versions and the code commits generated from it all
 * cascade with it (see `onDelete` in schema.prisma). Append-only governs edits
 * — restoring an old version writes a new one — but a prompt the workspace no
 * longer wants should not have to live forever to preserve that.
 *
 * EDITOR is the bar, matching `DELETE /api/prompts/[id]`, so a viewer cannot
 * reach it even by posting the form directly.
 */
export async function deletePromptAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get("id") ?? "");

  let slug: string;
  try {
    // Session first: looking the prompt up before authenticating would answer
    // "does this id exist?" for anyone, since a missing row returns 404 where a
    // real one returns 401.
    await requireSession();

    const prompt = await prisma.prompt.findUnique({
      where: { id },
      select: { workspaceId: true, workspace: { select: { slug: true } } },
    });
    if (!prompt) throw new AuthzError(404, "Prompt not found.");

    await requireMember(prompt.workspaceId, "EDITOR");
    await prisma.prompt.delete({ where: { id } });
    slug = prompt.workspace.slug;
  } catch (error) {
    return { error: messageOf(error) };
  }

  // Outside the try, as above: redirect signals itself by throwing.
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/explorer");
  redirect(`/dashboard?workspace=${slug}`);
}

/**
 * Ask for an agent run to be undone, or withdraw that request.
 *
 * Deliberately not an undo. Nothing in the browser can write to a developer's
 * working directory, and nothing in this project should be able to reach into
 * one on its own, so this only stamps the request on the run; `pops restore`
 * running on the machine that holds the files is what rewrites anything, and it
 * reports back through `POST /api/runs/[id]/restore`.
 *
 * The run itself is never edited — the log still says what the agent did after
 * the change has been undone.
 *
 * EDITOR is the bar, matching that route: asking for an undo is a write to the
 * project, so a viewer can read the diff and nothing more.
 */
export async function requestRestoreAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  const cancel = formData.get("cancel") === "1";

  try {
    // Session first, as in `deletePromptAction`: looking the run up before
    // authenticating would answer "does this id exist?" for anyone.
    const session = await requireSession();

    const run = await prisma.agentRun.findUnique({
      where: { id },
      select: { workspaceId: true },
    });
    if (!run) throw new AuthzError(404, "Run not found.");

    await requireMember(run.workspaceId, "EDITOR");

    await prisma.agentRun.update({
      where: { id },
      data: cancel
        ? { restoreRequestedAt: null, restoreRequestedById: null }
        : {
            restoreRequestedAt: new Date(),
            restoreRequestedById: session.user.id,
            // Asking again after an undo was already applied is a fresh
            // request, not a stale one, so the old stamp is cleared.
            restoredAt: null,
          },
    });
  } catch (error) {
    return { error: messageOf(error) };
  }

  revalidatePath(`/dashboard/runs/${id}`);
  revalidatePath("/dashboard/runs");
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
