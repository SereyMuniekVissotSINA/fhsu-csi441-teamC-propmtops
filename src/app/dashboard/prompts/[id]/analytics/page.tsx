import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSessionPage } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { UsageAnalytics } from "@/components/usage-analytics";

export const metadata = { title: "Token usage & savings | PromptOps" };

export default async function AnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSessionPage(`/dashboard/prompts/${id}/analytics`);
  const prompt = await prisma.prompt.findFirst({
    where: { id, workspace: { members: { some: { userId: session.user.id } } } },
    select: { title: true, versions: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, note: true } } },
  });
  if (!prompt) notFound();
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86_400_000);
  return <main className="mx-auto max-w-7xl space-y-6 px-6 py-10">
    <Link className="text-sm text-emerald-400 underline" href={`/dashboard/prompts/${id}`}>Back to prompt</Link>
    <header className="space-y-2">
      <h1 className="text-2xl font-semibold">Token usage &amp; savings</h1>
      <p className="text-zinc-300">{prompt.title}</p>
      <p className="max-w-3xl text-sm text-zinc-400">Compare recorded token usage, response latency, and estimated cost to help your team choose efficient prompt versions. Viewing or comparing these measurements consumes no AI tokens.</p>
    </header>
    <UsageAnalytics promptId={id} versions={prompt.versions.map((v, i) => ({ ...v, label: `v${prompt.versions.length - i}` }))}
      initialStart={start.toISOString().slice(0, 16)} initialEnd={end.toISOString().slice(0, 16)} />
  </main>;
}
