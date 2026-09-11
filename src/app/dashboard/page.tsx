import type { Metadata } from "next";
import Link from "next/link";

import { canEdit, requireSessionPage } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { action, panel } from "@/lib/ui";

import { NewPromptForm, NewWorkspaceForm } from "./new-forms";

export const metadata: Metadata = {
  title: "Dashboard | PromptOps",
};

function tagList(tags: string) {
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const session = await requireSessionPage("/dashboard");
  const { workspace: requested } = await searchParams;

  // Server component reads Prisma directly — going back out through the API
  // routes would add a round trip for no benefit.
  const workspaces = await prisma.workspace.findMany({
    where: { members: { some: { userId: session.user.id } } },
    orderBy: { createdAt: "asc" },
    include: {
      members: { where: { userId: session.user.id }, select: { role: true } },
      _count: { select: { prompts: true } },
    },
  });

  if (workspaces.length === 0) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className={`${panel} text-center`}>
          <h1 className="text-xl font-semibold">No workspaces yet</h1>
          <p className="mt-2 mb-6 text-sm text-zinc-400">
            Create one to start collecting prompts.
          </p>
          <NewWorkspaceForm />
        </div>
      </main>
    );
  }

  const active =
    workspaces.find((w) => w.slug === requested) ?? workspaces[0];
  const role = active.members[0]?.role ?? "VIEWER";

  const prompts = await prisma.prompt.findMany({
    where: { workspaceId: active.id },
    orderBy: { updatedAt: "desc" },
    include: {
      author: { select: { name: true } },
      versions: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { versions: true } },
    },
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{active.name}</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {active._count.prompts} prompt{active._count.prompts === 1 ? "" : "s"} ·
            you are {role.toLowerCase()}
          </p>
        </div>

        {workspaces.length > 1 ? (
          <nav className="flex flex-wrap gap-2">
            {workspaces.map((workspace) => (
              <Link
                key={workspace.id}
                href={`/dashboard?workspace=${workspace.slug}`}
                className={
                  workspace.id === active.id
                    ? `${action} border-emerald-500 text-emerald-400`
                    : action
                }
              >
                {workspace.name}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <section>
          <h2 className="mb-3 text-sm font-medium tracking-wide text-zinc-400 uppercase">
            Prompts
          </h2>

          {prompts.length === 0 ? (
            <div className={`${panel} text-sm text-zinc-400`}>
              Nothing here yet.{" "}
              {canEdit(role)
                ? "Create the first prompt using the form."
                : "Ask an editor to add one."}
            </div>
          ) : (
            <ul className="space-y-3">
              {prompts.map((prompt) => (
                <li key={prompt.id}>
                  <Link
                    href={`/dashboard/prompts/${prompt.id}`}
                    className={`${panel} block transition hover:border-zinc-700`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <h3 className="font-medium">{prompt.title}</h3>
                      <span className="shrink-0 font-mono text-xs text-zinc-500">
                        v{prompt._count.versions}
                      </span>
                    </div>

                    <p className="mt-2 line-clamp-2 font-mono text-xs text-zinc-500">
                      {prompt.versions[0]?.body}
                    </p>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {tagList(prompt.versions[0]?.tags ?? "").map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md border border-zinc-800 px-2 py-0.5 text-xs text-zinc-400"
                        >
                          {tag}
                        </span>
                      ))}
                      <span className="ml-auto text-xs text-zinc-600">
                        {prompt.author.name ?? "Unknown"} ·{" "}
                        {prompt.updatedAt.toISOString().slice(0, 10)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-6">
          {/* Viewers can read everything and change nothing, so the editing
              affordances are not rendered for them at all. */}
          {canEdit(role) ? (
            <div className={panel}>
              <h2 className="mb-4 text-sm font-medium tracking-wide text-zinc-400 uppercase">
                New prompt
              </h2>
              <NewPromptForm workspaceId={active.id} />
            </div>
          ) : null}

          <div className={panel}>
            <h2 className="mb-4 text-sm font-medium tracking-wide text-zinc-400 uppercase">
              New workspace
            </h2>
            <NewWorkspaceForm />
          </div>
        </aside>
      </div>
    </main>
  );
}
