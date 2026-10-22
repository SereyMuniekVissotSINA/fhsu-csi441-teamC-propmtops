import { cn } from "@/lib/utils";

// Shared class strings for the database-backed pages, matching the visual
// language the landing page and demo already use (#080808 / zinc / emerald).
//
// The demo defines its own copies inline in `src/components/demo/workspace.tsx`.
// They are deliberately not refactored to import these: the demo is the offline
// fallback and stays untouched, so a change here can never break it.

export const action =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-400 disabled:cursor-not-allowed disabled:opacity-40";

export const primary = cn(
  action,
  "border-emerald-500 bg-emerald-500 text-black hover:bg-emerald-400",
);

export const field =
  "w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400";

export const page = "min-h-screen bg-[#080808] text-white";

export const panel = "rounded-xl border border-zinc-800 bg-zinc-950/60 p-6";
