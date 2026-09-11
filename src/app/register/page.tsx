import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { BackendUnavailable } from "@/components/backend-unavailable";
import { isAuthReady } from "@/lib/backend-status";
import { page, panel } from "@/lib/ui";

import { RegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "Create an account | PromptOps",
};

export default async function RegisterPage() {
  if (!(await isAuthReady()))
    return <BackendUnavailable what="Creating an account" />;

  const session = await auth();
  if (session?.user) redirect("/dashboard");

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
          <h1 className="text-xl font-semibold">Create your account</h1>
          <p className="mt-1 mb-6 text-sm text-zinc-400">
            You will get a personal workspace to start from.
          </p>

          <RegisterForm />
        </div>
      </div>
    </main>
  );
}
