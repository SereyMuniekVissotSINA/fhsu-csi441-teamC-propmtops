"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Feature = {
  title: string;
  description: string;
  icon: string;
  status:
    | "Demo available"
    | "Planned"
    | "Needs setup"
    | "Needs verification";
  details: string;
  href?: string;
  cta?: string;
};

const features: Feature[] = [
  {
    title: "Auth & Workspaces",
    description:
      "Explore demo identities, workspaces, and role-based permissions.",
    icon: "◉",
    status: "Demo available",
    details:
      "Explore the demo experience for workspace membership and owner, editor, and viewer roles. The browser demo uses local browser state, so it does not demonstrate production authentication or prove that permissions are enforced by a live backend.",
    href: "/demo",
    cta: "Explore the demo",
  },
  {
    title: "Version Control",
    description:
      "Explore prompt history and compare changes between versions.",
    icon: "⌘",
    status: "Demo available",
    details:
      "Explore the existing history demo to see the available version comparison experience. Verify restoration and persistent version storage before relying on them as production capabilities.",
    href: "/demo?view=history",
    cta: "Explore version history",
  },
  {
    title: "Prompt CMS",
    description:
      "Organize prompt templates and preview dynamic variables.",
    icon: "</>",
    status: "Demo available",
    details:
      "Explore prompt content and variable placeholders such as {{customer_name}}. The browser demo uses local browser storage; it should not be confused with persistent database storage or production team collaboration.",
    href: "/demo",
    cta: "Explore prompt management",
  },
  {
    title: "Proxy API",
    description:
      "Learn how prompts and variables can be sent to an LLM through an API.",
    icon: "ϟ",
    status: "Planned",
    details:
      "The intended flow accepts a prompt identifier and variables, prepares the prompt, calls a configured language model, and returns a response. Confirm the API implementation and provider configuration with the backend team before treating this as available.",
  },
  {
    title: "Token Analytics",
    description:
      "Understand token usage, latency, and estimated prompt costs.",
    icon: "▥",
    status: "Needs setup",
    details:
      "Meaningful analytics require the relevant database setup and usage measurements to be submitted. Values depend on the data received; this demo does not automatically produce real usage statistics or guarantee cost savings.",
  },
  {
    title: "RESTful API",
    description:
      "Explore the intended API for reporting prompt usage and related metrics.",
    icon: ">_",
    status: "Needs verification",
    details:
      "The repository describes a usage-reporting endpoint, POST /api/usage, that accepts measurements using a workspace API key. Confirm the endpoint and its authentication and configuration requirements with the backend team before treating it as production-ready.",
  },
];

export default function FeatureExplorer() {
  const [selected, setSelected] = useState<Feature | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (selected && !dialog.open) {
      dialog.showModal();
    } else if (!selected && dialog.open) {
      dialog.close();
    }
  }, [selected]);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => (
          <button
            key={feature.title}
            type="button"
            onClick={() => setSelected(feature)}
            aria-haspopup="dialog"
            className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-6 text-left transition hover:border-emerald-500/50 hover:bg-zinc-900/80 focus-visible:outline-2 focus-visible:outline-emerald-400"
          >
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm text-emerald-500">
                {feature.icon}
              </span>
              <h3 className="font-semibold text-zinc-100">
                {feature.title}
              </h3>
            </div>

            <p className="mt-5 text-sm leading-6 text-zinc-400">
              {feature.description}
            </p>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-emerald-400">
                {feature.status}
              </span>
              <span className="text-sm text-zinc-300">
                View details →
              </span>
            </div>
          </button>
        ))}
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="feature-dialog-title"
        onCancel={() => setSelected(null)}
        onClose={() => setSelected(null)}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-zinc-700 bg-zinc-950 p-0 text-white backdrop:bg-black/75"
      >
        {selected && (
          <div className="p-6 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-emerald-400">
                  {selected.status}
                </p>
                <h3
                  id="feature-dialog-title"
                  className="mt-2 text-2xl font-semibold"
                >
                  {selected.title}
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close feature details"
                className="rounded-lg px-3 py-2 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="mt-5 text-sm leading-7 text-zinc-300">
              {selected.details}
            </p>

            <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="text-sm font-medium text-zinc-200">
                Availability and requirements
              </p>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                {selected.href
                  ? "You can explore the existing demo for this feature. Some capabilities may be limited to the demo or require additional setup."
                  : "This feature is informational for now. Check its implementation and requirements with the backend team."}
              </p>
            </div>

            <div className="mt-7 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
              >
                Close
              </button>

              {selected.href && (
                <Link
                  href={selected.href}
                  onClick={() => setSelected(null)}
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400"
                >
                  {selected.cta ?? "Explore"} →
                </Link>
              )}
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
