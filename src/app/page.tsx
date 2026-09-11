import Link from "next/link";

const features = [
  {
    title: "Auth & Workspaces",
    description:
      "Try demo sign-in, switch team workspaces, and explore owner, editor, and viewer permissions.",
    icon: "◉",
    href: "/demo",
    cta: "Try auth & workspaces",
  },
  {
    title: "Version Control",
    description:
      "Save immutable snapshots, compare changes side by side, and restore earlier versions with an audit trail.",
    icon: "⌘",
    href: "/demo?view=history",
    cta: "Try version control",
  },
  {
    title: "Prompt CMS",
    description:
      "Full CRUD with dynamic {{variables}} and per-prompt model targeting.",
    icon: "</>",
  },
  {
    title: "Proxy API",
    description:
      "Send prompt_id and variables. We inject, call the LLM, log usage, and return the result.",
    icon: "ϟ",
  },
  {
    title: "Token Analytics",
    description:
      "Track token consumption, API calls, latency, and estimated cost per prompt.",
    icon: "▥",
  },
  {
    title: "RESTful API",
    description:
      "Clean JSON responses with consistent error handling and authentication.",
    icon: ">_",
  },
];

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

          {/* Navigation buttons */}
          <div className="flex items-center gap-3">
            <Link
              href="#features"
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
      <section className="mx-auto flex max-w-6xl flex-col items-center px-6 pb-20 pt-28 text-center">
        <h1 className="max-w-4xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
          Version-Control Your{" "}
          <span className="text-emerald-500">AI Prompts</span>
        </h1>

        <p className="mt-6 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
          Store, version, and proxy your LLM prompts with full token analytics.
          The Git for prompts — built for engineering teams.
        </p>

        {/* Hero buttons */}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/demo"
            className="rounded-lg bg-emerald-500 px-6 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400"
          >
            Open Demo &gt;_
          </Link>

          <Link
            href="#features"
            className="rounded-lg border border-zinc-700 px-6 py-3 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-900"
          >
            Explore Features
          </Link>
        </div>
        <p className="mt-4 text-xs text-zinc-500">
          No account needed. Demo prompts are saved in your browser.
        </p>
      </section>

      {/* Features */}
      <section
        id="features"
        className="mx-auto max-w-6xl scroll-mt-8 px-6 pb-24"
      >
        <h2 className="mb-3 text-2xl font-semibold">
          Built for the prompt lifecycle
        </h2>
        <p className="mb-8 text-sm leading-6 text-zinc-400">
          Demo identities, workspace roles, prompt storage, version comparison,
          and variable previews are ready to explore. Live authentication, LLM
          calls, and analytics are planned.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-6 transition hover:border-emerald-500/40 hover:bg-zinc-900/80"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm text-emerald-500">
                  {feature.icon}
                </span>

                <h2 className="font-semibold text-zinc-100">{feature.title}</h2>
              </div>

              <p className="mt-6 text-sm leading-6 text-zinc-400">
                {feature.description}
              </p>
              {feature.href && (
                <Link
                  href={feature.href}
                  className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-emerald-400 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-emerald-400"
                >
                  {feature.cta} <span aria-hidden="true">→</span>
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
