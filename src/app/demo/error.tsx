"use client";

import Link from "next/link";

export default function DemoError({ retry }: { retry: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-[#080808] px-6 text-white">
      <h1 className="text-2xl font-semibold">The workspace couldn’t open</h1>
      <p className="text-zinc-400">Try again to reload your saved prompts.</p>
      <button
        className="rounded-lg bg-emerald-500 px-5 py-3 text-black"
        onClick={retry}
      >
        Try again
      </button>
      <Link href="/" className="text-zinc-300 underline">
        Back to home
      </Link>
    </main>
  );
}
