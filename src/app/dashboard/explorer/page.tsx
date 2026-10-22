import Link from "next/link";
import { notFound } from "next/navigation";
import { PromptLibrary } from "@/components/demo/prompt-explorer";
import { BackendUnavailable } from "@/components/backend-unavailable";
import { isAuthReady } from "@/lib/backend-status";
import { requireSessionPage } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { action } from "@/lib/ui";

export const metadata = { title: "Workspace library | PromptOps" };

export default async function ExplorerPage({ searchParams }: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  if (!(await isAuthReady())) return <BackendUnavailable what="The prompt library" />;
  const session = await requireSessionPage("/dashboard/explorer");
  const { workspace: requested } = await searchParams;
  const workspaces = await prisma.workspace.findMany({
    where: { members: { some: { userId: session.user.id } } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, slug: true },
  });
  const workspace = requested ? workspaces.find((item) => item.slug === requested) : workspaces[0];
  if (requested && !workspace) notFound();
  if (!workspace) return <main className="mx-auto max-w-7xl p-8"><p>Create a workspace to start your library.</p><Link className={action} href="/dashboard">Open dashboard</Link></main>;
  const prompts = await prisma.prompt.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      versions: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, title: true, body: true, tags: true, note: true, createdAt: true, author: { select: { name: true } } },
      },
    },
  });
  const library = prompts.filter((prompt) => prompt.versions.length > 0).map((prompt) => ({
    id: prompt.id,
    versions: prompt.versions.map((version) => ({ ...version, createdAt: version.createdAt.toISOString(), author: version.author?.name ?? "Unknown author" })),
  }));
  return <>
    <nav aria-label="Workspace libraries" className="mx-auto flex max-w-7xl flex-wrap gap-2 px-6 pt-6">
      {workspaces.map((item) => <Link key={item.id} className={action} aria-current={item.id === workspace.id ? "page" : undefined} href={`/dashboard/explorer?workspace=${encodeURIComponent(item.slug)}`}>{item.name}</Link>)}
    </nav>
    <PromptLibrary key={workspace.id} workspace={workspace} initialPrompts={library} />
  </>;
}
