import Link from "next/link";

import { BackendUnavailable } from "@/components/backend-unavailable";
import { isAuthReady } from "@/lib/backend-status";
import { action, page } from "@/lib/ui";

import { signOutAction } from "./actions";

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  // Checked once here rather than in every dashboard page.
  if (!(await isAuthReady())) return <BackendUnavailable what="The dashboard" />;

  return (
    <div className={page}>
      <nav className="border-b border-zinc-800/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 font-mono text-sm font-bold text-black">
              &gt;_
            </div>
            <span className="text-lg font-semibold tracking-tight">PromptOps</span>
          </Link>

          <div className="flex items-center gap-3">
            <Link
              href="/demo"
              className="rounded-lg px-4 py-2 text-sm text-zinc-300 transition hover:text-white"
            >
              Demo
            </Link>
            <form action={signOutAction}>
              <button className={action} type="submit">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </nav>

      {children}
    </div>
  );
}
