import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-[#080808] px-6 text-center text-white">
      <p className="font-mono text-emerald-400">404 / PAGE NOT FOUND</p>
      <h1 className="text-3xl font-semibold">
        This page isn’t in the workspace.
      </h1>
      <p className="text-zinc-400">
        Head home or open the demo to keep exploring.
      </p>
      <div className="flex gap-4">
        <Link className="rounded-lg border border-zinc-700 px-5 py-3" href="/">
          Back to home
        </Link>
        <Link
          className="rounded-lg bg-emerald-500 px-5 py-3 text-black"
          href="/demo"
        >
          Open demo
        </Link>
      </div>
    </main>
  );
}
