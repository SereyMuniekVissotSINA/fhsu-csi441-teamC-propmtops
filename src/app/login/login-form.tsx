"use client";

import Link from "next/link";
import { useActionState } from "react";

import { field, primary } from "@/lib/ui";

import { loginAction, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <div className="space-y-1.5">
        <label className="text-sm text-zinc-300" htmlFor="email">
          Email
        </label>
        <input
          className={field}
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm text-zinc-300" htmlFor="password">
          Password
        </label>
        <input
          className={field}
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
        />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-400">
          {state.error}
        </p>
      ) : null}

      <button className={`${primary} w-full`} type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <p className="text-center text-sm text-zinc-400">
        No account?{" "}
        <Link className="text-emerald-400 hover:underline" href="/register">
          Create one
        </Link>
      </p>
    </form>
  );
}
