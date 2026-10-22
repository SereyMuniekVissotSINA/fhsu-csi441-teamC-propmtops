import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { BackendUnavailable } from "@/components/backend-unavailable";
import { configuredOAuthProviders } from "@/lib/auth-providers";
import { isAuthReady } from "@/lib/backend-status";
import { action, page, panel } from "@/lib/ui";

import { oauthSignInAction } from "./actions";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in | PromptOps",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // Credentials sign-in reads the user table, so without a database this page
  // can only mislead. Say so instead of throwing.
  if (!(await isAuthReady())) return <BackendUnavailable what="Signing in" />;

  const { next } = await searchParams;
  const target = typeof next === "string" && next.startsWith("/") ? next : "/dashboard";

  const session = await auth();
  if (session?.user) redirect(target);

  // Only providers with both halves of their credentials configured, so a
  // button can never lead to a broken OAuth round trip.
  const providers = configuredOAuthProviders();

  return (
    <main className={`${page} flex flex-col items-center justify-center px-6 py-16`}>
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 font-mono text-sm font-bold text-black">
            &gt;_
          </div>
          <span className="text-lg font-semibold tracking-tight">PromptOps</span>
        </Link>

        <div className={panel}>
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="mt-1 mb-6 text-sm text-zinc-400">
            Welcome back. Pick up where you left off.
          </p>

          <LoginForm next={target} />

          {providers.length > 0 ? (
            <>
              <div className="my-6 flex items-center gap-3 text-xs text-zinc-500">
                <span className="h-px flex-1 bg-zinc-800" />
                OR
                <span className="h-px flex-1 bg-zinc-800" />
              </div>

              <div className="space-y-3">
                {providers.map((provider) => (
                  <form key={provider.id} action={oauthSignInAction}>
                    <input type="hidden" name="provider" value={provider.id} />
                    <input type="hidden" name="next" value={target} />
                    <button className={`${action} w-full`} type="submit">
                      Continue with {provider.label}
                    </button>
                  </form>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <p className="mt-6 text-center text-xs text-zinc-500">
          Just exploring?{" "}
          <Link className="text-zinc-300 hover:underline" href="/demo">
            Open the demo
          </Link>{" "}
          — no account needed.
        </p>
      </div>
    </main>
  );
}
