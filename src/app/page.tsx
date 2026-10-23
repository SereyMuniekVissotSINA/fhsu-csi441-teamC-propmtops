import Link from "next/link";
import FeatureExplorer from "@/components/feature-explorer";
import PromptPreview from "@/components/prompt-preview";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#080808] text-white">
      {/* Navigation */}
      <nav className="border-b border-zinc-800/70">
        <div className="mx-auto flex h-18 max-w-6xl items-center justify-between px-6">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 font-mono text-sm font-bold text-black">
              &gt;_
            </div>

            <span className="text-lg font-semibold tracking-tight">
              PromptOps
            </span>
          </Link>

          {/* Navigation links */}
          <div className="flex items-center gap-3">
            <Link
              href="/features"
              className="rounded-lg px-4 py-2 text-sm text-zinc-300 transition hover:text-white"
            >
              Features
            </Link>

            <Link
              href="/login"
              className="rounded-lg px-4 py-2 text-sm text-zinc-300 transition hover:text-white"
            >
              Sign in
            </Link>

            <Link
              href="/demo"
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-emerald-400"
            >
              Try Demo
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto flex max-w-6xl flex-col items-center px-6 pb-16 pt-24 text-center sm:pt-28">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-4 py-2 text-xs font-medium text-emerald-400">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          A better way to manage AI prompts
        </div>

        <h1 className="max-w-4xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
          Version-Control Your{" "}
          <span className="text-emerald-500">AI Prompts</span>
        </h1>

        <p className="mt-6 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
          Manage prompt changes, compare versions, and preview dynamic
          variables in one place. Give your team a clearer way to develop
          and maintain AI prompts.
        </p>

        {/* Hero buttons */}
        <div className="mt-8 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
          <Link
            href="/demo"
            className="rounded-lg bg-emerald-500 px-6 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
          >
            Explore the demo →
          </Link>

          <Link
            href="/features"
            className="rounded-lg border border-zinc-700 px-6 py-3 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
          >
            Discover features
          </Link>
        </div>

        <p className="mt-4 text-xs text-zinc-500">
          Explore the demo without an account.
        </p>
      </section>

      {/* Product preview */}
      <PromptPreview />

      {/* Call to action */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-6 py-12 text-center sm:px-12">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Ready to explore PromptOps?
          </h2>

          <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-zinc-400 sm:text-base">
            Discover the available features, explore the demo, and see
            how prompt versioning can fit into your workflow.
          </p>

          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/features"
              className="rounded-lg border border-zinc-700 px-5 py-3 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-900"
            >
              Explore features
            </Link>

            <Link
              href="/demo"
              className="rounded-lg bg-emerald-500 px-5 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400"
            >
              Open demo →
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-800/70">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-8 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/"
            className="font-semibold text-zinc-300 transition hover:text-white"
          >
            PromptOps
          </Link>

          <div className="flex flex-wrap gap-5">
            <Link
              href="/features"
              className="transition hover:text-white"
            >
              Features
            </Link>

            <Link
              href="/demo"
              className="transition hover:text-white"
            >
              Demo
            </Link>

            <Link
              href="/login"
              className="transition hover:text-white"
            >
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
