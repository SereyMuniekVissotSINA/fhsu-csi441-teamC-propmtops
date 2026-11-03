"use client";

import { useActionState } from "react";

import { field, primary } from "@/lib/ui";

import { createPromptAction, createWorkspaceAction, type FormState } from "./actions";

export function NewWorkspaceForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createWorkspaceAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-2 sm:flex-row">
      <input
        className={field}
        name="name"
        required
        maxLength={60}
        placeholder="New workspace name"
        aria-label="New workspace name"
      />
      <button className={primary} type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create"}
      </button>
      {state.error ? (
        <p role="alert" className="text-sm text-red-400 sm:self-center">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function NewPromptForm({ workspaceId }: { workspaceId: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createPromptAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />

      <input
        className={field}
        name="title"
        required
        maxLength={120}
        placeholder="Prompt title"
        aria-label="Prompt title"
      />

      <textarea
        className={`${field} min-h-28 font-mono`}
        name="body"
        required
        placeholder="Write your prompt. Use {{variables}} for the parts that change."
        aria-label="Prompt body"
      />

      <input
        className={field}
        name="tags"
        placeholder="Tags, comma separated"
        aria-label="Tags"
      />

      {state.error ? (
        <p role="alert" className="text-sm text-red-400">
          {state.error}
        </p>
      ) : null}

      <button className={primary} type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create prompt"}
      </button>
    </form>
  );
}
