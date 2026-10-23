"use client";

import { useActionState, useState } from "react";
import { RotateCcw } from "lucide-react";

import { action, danger } from "@/lib/ui";

import { requestRestoreAction, type FormState } from "../../actions";

/**
 * Ask for a run to be undone.
 *
 * Two clicks rather than one, the way deleting a prompt is: this asks for the
 * developer's working directory to be overwritten, which is not a thing to set
 * in motion by mis-clicking. The browser only records the request — the CLI on
 * the machine holding the files is what writes anything — so the copy says so
 * rather than implying the files have already changed.
 *
 * Rendered for EDITOR and above. The server action checks the role again
 * regardless; a hidden button is not an authorization boundary.
 */
export function RestoreRun({
  id,
  sequence,
  requested,
  restoredAt,
}: {
  id: string;
  sequence: number;
  requested: boolean;
  restoredAt: string | null;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    requestRestoreAction,
    {},
  );
  const [confirming, setConfirming] = useState(false);

  if (requested) {
    return (
      <div className="rounded-xl border border-amber-900/70 bg-amber-950/20 p-4">
        <p className="text-sm text-amber-200">Waiting for this restore to be applied.</p>
        <p className="mt-1 text-xs text-zinc-400">
          Run <code className="font-mono">pops restore r{sequence}</code> in the project, or
          leave <code className="font-mono">pops restore --watch --yes</code> running there.
        </p>
        <form action={formAction} className="mt-3">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="cancel" value="1" />
          <button type="submit" className={action} disabled={pending}>
            {pending ? "Withdrawing…" : "Withdraw the request"}
          </button>
        </form>
        {state.error && (
          <p role="alert" className="mt-3 text-sm text-red-300">
            {state.error}
          </p>
        )}
      </div>
    );
  }

  if (!confirming) {
    return (
      <div>
        <button type="button" className={danger} onClick={() => setConfirming(true)}>
          <RotateCcw size={14} aria-hidden="true" />
          {restoredAt ? "Restore again" : "Restore the pre-run files"}
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
        Put the files back as they were before r{sequence}?
      </p>
      <p className="mt-1 text-xs text-zinc-400">
        Every file below is rewritten from its before-contents, and files the run created are
        deleted. Anything changed since then in those files is lost. The run itself stays in the
        log.
      </p>
      <div className="mt-3 flex gap-2">
        <button type="submit" className={danger} disabled={pending}>
          {pending ? "Requesting…" : "Yes, request the restore"}
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
