
import Link from "next/link";
import FeatureExplorer from "@/components/feature-explorer";

export default function FeaturesPage() {
  return (
    <main className="min-h-screen bg-[#080808] text-white">
      <nav className="border-b border-zinc-800/70 px-6 py-5">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link href="/" className="text-lg font-semibold">
            PromptOps
          </Link>

          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm text-zinc-300 hover:text-white">
              Sign in
            </Link>
            <Link
              href="/demo"
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400"
            >
              Try Demo
            </Link>
          </div>
        </div>
      </nav>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <Link href="/" className="text-sm text-emerald-400 hover:text-emerald-300">
          ← Back to Home
        </Link>

        <p className="mt-8 text-sm font-medium uppercase tracking-widest text-emerald-400">
          Explore PromptOps
        </p>

        <h1 className="mt-4 text-4xl font-bold sm:text-5xl">
          Explore PromptOps Features
        </h1>

        <p className="mt-5 mb-10 max-w-2xl leading-7 text-zinc-400">
          Discover tools for managing prompts, comparing versions,
          and maintaining your AI prompt workflow.
        </p>

        <FeatureExplorer />
      </section>
    </main>
  );
}
