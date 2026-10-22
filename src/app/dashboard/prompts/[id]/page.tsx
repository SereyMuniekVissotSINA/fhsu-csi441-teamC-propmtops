import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { canEdit, requireSessionPage } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

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
    </main>
  );
}
