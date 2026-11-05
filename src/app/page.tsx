import Link from "next/link";

import { SetupGuide } from "@/components/setup-guide";


const features = [
  {
    title: "Auth & Workspaces",
    description:
      "Sign in, switch team workspaces, and explore owner, editor, and viewer permissions.",
    icon: "◉",
    href: "/dashboard",
    cta: "Open your workspace",
  },
  {
    title: "Version Control",
    description:
      "Save immutable snapshots, compare changes side by side, and restore earlier versions with an audit trail.",
    icon: "⌘",
    href: "/dashboard/explorer",
    cta: "Browse the library",
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

/** Section heading. Sentence case with a full stop — the editorial voice. */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="max-w-[850px] text-[clamp(1.75rem,3vw,2.2rem)] leading-[1.14] font-[650] tracking-[-0.035em] text-white">
      {children}
    </h2>
  );
}

export default function Home() {
  return (
    <main className="font-system min-h-screen bg-[#0e1111] text-white">
      <nav className="border-b border-zinc-800/70">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-[5px] bg-emerald-500 font-mono text-sm font-bold text-black">
              &gt;_
            </div>
            <span className="text-[1.05rem] font-[650] tracking-[-0.02em]">PromptOps</span>
          </Link>

          <div className="flex items-center gap-1 sm:gap-2">
            <Link
              href="#connect"
              className="rounded-[5px] px-3 py-2 text-[0.95rem] font-medium text-zinc-300 transition hover:text-white"
            >
              Connect
            </Link>
            <Link
              href="#features"
              className="rounded-[5px] px-3 py-2 text-[0.95rem] font-medium text-zinc-300 transition hover:text-white"
            >
              Features
            </Link>
            <Link
              href="/login"
              className="rounded-[5px] px-3 py-2 text-[0.95rem] font-medium text-zinc-300 transition hover:text-white"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="ml-1 rounded-[5px] bg-emerald-500 px-4 py-2 text-[0.95rem] font-medium text-black transition hover:bg-emerald-400"
            >
              Get started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero — left-aligned, so the headline and the lede share one edge and
          the eye has a single place to start. */}
      <section className="mx-auto max-w-[1200px] px-6 pt-[5.8rem] pb-[4.6rem]">
        <h1 className="max-w-[900px] text-[clamp(2.55rem,10vw,3.75rem)] leading-[1.14] font-[750] tracking-[-0.035em]">
          Version-control your
          <br />
          <span className="text-emerald-500">AI prompts.</span>
        </h1>

        <p className="mt-6 max-w-[710px] text-[1.5rem] leading-[1.7] font-bold text-zinc-400">
          Store, version, and proxy your LLM prompts with full token analytics. The Git for
          prompts — built for engineering teams.
        </p>

        {/* One solid button and one plain text link. A second filled button
            would compete with the first and neither would read as the primary
            action. */}
        <div className="mt-8 flex flex-wrap items-center gap-[1.6rem]">
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-[7px] bg-emerald-500 px-8 py-[0.8rem] text-[0.99rem] font-bold text-black transition hover:bg-emerald-400"
          >
            Open dashboard
          </Link>
          <Link
            href="#connect"
            className="text-[0.99rem] font-bold text-emerald-400 underline-offset-4 transition hover:underline"
          >
            Connect your editor ↓
          </Link>
        </div>

        <p className="mt-6 text-[0.9rem] text-zinc-500">
          Prompts and their history are stored in PostgreSQL.
        </p>
      </section>

      {/* Setup sits directly under the hero: the first thing a reader wants
          after "what is this" is "what do I paste". */}
      <SetupGuide />

      <section
        id="features"
        className="scroll-mt-8 border-t border-zinc-800/70 py-[3.8rem]"
      >
        <div className="mx-auto max-w-[1200px] px-6">
          <SectionHeading>Built for the prompt lifecycle.</SectionHeading>
          <p className="mt-5 mb-10 max-w-[710px] text-[1.075rem] leading-[1.7] text-zinc-400">
            Authentication, workspace roles, prompt storage, version comparison, and variable
            previews all work today. Running a prompt against a model is development-only for
            now, and token analytics are planned.
          </p>

          <div className="grid gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div key={feature.title}>
                <div className="flex items-center gap-3">
                  <span className="font-system-mono text-[0.85rem] text-emerald-500">
                    {feature.icon}
                  </span>
                  <h3 className="text-[1.075rem] font-[650] tracking-[-0.02em] text-zinc-100">
                    {feature.title}
                  </h3>
                </div>

                <p className="mt-3 text-[0.95rem] leading-[1.65] text-zinc-400">
                  {feature.description}
                </p>

                {feature.href && (
                  <Link
                    href={feature.href}
                    className="mt-3 inline-flex items-center gap-2 text-[0.9rem] font-medium text-emerald-400 underline-offset-4 transition hover:underline focus-visible:outline-2 focus-visible:outline-emerald-400"
                  >
                    {feature.cta} <span aria-hidden="true">→</span>
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-zinc-800/70 py-[2.4rem]">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-6 text-[0.85rem] text-zinc-500">
          <span>PromptOps — version control for prompts and the code they generate.</span>
          <span className="font-system-mono">CSI 441 · Team C</span>
        </div>
      </footer>
    </main>
  );
}
