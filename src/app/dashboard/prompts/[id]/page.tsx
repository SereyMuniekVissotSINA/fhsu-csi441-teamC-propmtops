import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { canEdit, requireSessionPage } from "@/lib/authz";
import { commitStats } from "@/lib/code-commits";
import { prisma } from "@/lib/prisma";

import { DeletePrompt } from "./delete-prompt";
import { PromptEditor } from "./editor";

export const metadata: Metadata = {
  title: "Prompt | PromptOps",
};

export default async function PromptPage({
  params,
}: PageProps<"/dashboard/prompts/[id]">) {
  const { id } = await params;
  const session = await requireSessionPage(`/dashboard/prompts/${id}`);

  const prompt = await prisma.prompt.findFirst({
    // Scoped by membership in the same query: a prompt in someone else's
    // workspace is indistinguishable from one that does not exist.
    where: {
      id,
      workspace: { members: { some: { userId: session.user.id } } },
    },
    include: {
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true,
          members: { where: { userId: session.user.id }, select: { role: true } },
        },
      },
      versions: {
        orderBy: { createdAt: "desc" },
        include: { author: { select: { name: true } } },
      },
    },
  });

  if (!prompt || prompt.versions.length === 0) notFound();

  const role = prompt.workspace.members[0]?.role ?? "VIEWER";

  // The generated-code history, newest first. File contents are left out here
  // and fetched per commit by the log, so opening a prompt with a long history
  // does not ship every file it ever produced.
  const commits = await prisma.codeCommit.findMany({
    where: { promptId: prompt.id },
    orderBy: { sequence: "desc" },
    include: {
      author: { select: { name: true } },
      files: {
        orderBy: { path: "asc" },
        select: {
          path: true,
          hash: true,
          language: true,
          change: true,
          added: true,
          removed: true,
        },
      },
    },
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <nav className="mb-6 text-sm text-zinc-500">
        <Link
          className="hover:text-white"
          href={`/dashboard?workspace=${prompt.workspace.slug}`}
        >
          ← {prompt.workspace.name}
        </Link>
      </nav>

      <h1 className="mb-8 text-2xl font-semibold">{prompt.title}</h1>

      <PromptEditor
        id={prompt.id}
        editable={canEdit(role)}
        commits={commits.map((commit) => ({
          id: commit.id,
          sequence: commit.sequence,
          message: commit.message,
          parentId: commit.parentId,
          promptVersionId: commit.promptVersionId,
          model: commit.model,
          elapsedMs: commit.elapsedMs,
          inputTokens: commit.inputTokens,
          outputTokens: commit.outputTokens,
          incomplete: commit.incomplete,
          createdAt: commit.createdAt.toISOString(),
          authorName: commit.author?.name ?? null,
          stats: commitStats(commit.files),
          files: commit.files,
        }))}
        versions={prompt.versions.map((version) => ({
          id: version.id,
          title: version.title,
          body: version.body,
          tags: version.tags,
          note: version.note,
          // Dates cannot cross the server/client boundary as Date objects.
          createdAt: version.createdAt.toISOString(),
          authorName: version.author?.name ?? null,
        }))}
      />

      {canEdit(role) && (
        <section className="mt-10 border-t border-zinc-800 pt-6">
          <h2 className="mb-1 text-sm font-medium text-zinc-300">Danger zone</h2>
          <p className="mb-4 text-xs text-zinc-500">
            Removes this prompt and its history from the database.
          </p>
          <DeletePrompt id={prompt.id} title={prompt.title} />
        </section>
      )}
    </main>
  );
}
