"use client";

import { useActionState, useState } from "react";
import { Trash2 } from "lucide-react";

import { action, danger } from "@/lib/ui";

import { deletePromptAction, type FormState } from "../../actions";

/**
 * Deleting a prompt takes two clicks rather than a browser `confirm()`: the
 * native dialog is blocking, unstyled, and suppressible, which is poor footing
 * for the only irreversible control in the app.
 *
 * Rendered only for EDITOR and above. The server action checks the role again
 * regardless — a hidden button is not an authorization boundary.
 */
export function DeletePrompt({ id, title }: { id: string; title: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    deletePromptAction,
    {},
  );
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <div>
        <button type="button" className={danger} onClick={() => setConfirming(true)}>
          <Trash2 size={14} aria-hidden="true" />
          Delete prompt
        </button>
        {state.error && (
          <p role="alert" className="mt-2 text-sm text-red-300">
            {state.error}
          </p>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="rounded-xl border border-red-900/70 bg-red-950/20 p-4">
      <input type="hidden" name="id" value={id} />
      <p className="text-sm text-zinc-200">
        Delete <span className="font-medium">{title}</span>?
      </p>
      <p className="mt-1 text-xs text-zinc-400">
        Every saved version and every generated-code commit goes with it. This cannot be undone.
      </p>
      <div className="mt-3 flex gap-2">
        <button type="submit" className={danger} disabled={pending}>
          {pending ? "Deleting…" : "Yes, delete it"}
        </button>
        <button
          type="button"
          className={action}
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          Cancel
        </button>
      </div>
      {state.error && (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {state.error}
        </p>
      )}
    </form>
  );
}
