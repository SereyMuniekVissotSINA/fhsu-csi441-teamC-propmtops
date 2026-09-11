"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";

import { field, primary } from "@/lib/ui";
import { registerSchema } from "@/lib/validations";

export function RegisterForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const parsed = registerSchema.safeParse({
      name: form.get("name"),
      email: form.get("email"),
      password: form.get("password"),
    });

    if (!parsed.success) {
      // Surface the first real complaint rather than a generic message.
      setError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
      return;
    }

    setPending(true);
    try {
      // Reuses the existing route handler — the validation and bcrypt hashing
      // already live there, so this page does not repeat them.
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error ?? "Could not create the account.");
        return;
      }

      // Registering should leave you signed in, not back at the login page.
      await signIn("credentials", {
        email: parsed.data.email,
        password: parsed.data.password,
        redirectTo: "/dashboard",
      });
    } catch {
      setError("Could not reach the server. Is it still running?");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-sm text-zinc-300" htmlFor="name">
          Name
        </label>
        <input
          className={field}
          id="name"
          name="name"
          autoComplete="name"
          required
          placeholder="Alex Morgan"
        />
      </div>

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
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="At least 8 characters"
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}

      <button className={`${primary} w-full`} type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </button>

      <p className="text-center text-sm text-zinc-400">
        Already have an account?{" "}
        <Link className="text-emerald-400 hover:underline" href="/login">
          Sign in
        </Link>
      </p>
    </form>
  );
}
