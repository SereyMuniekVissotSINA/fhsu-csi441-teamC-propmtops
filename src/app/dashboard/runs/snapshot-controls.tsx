"use client";

import { useActionState } from "react";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";

import { action, danger } from "@/lib/ui";

import { archiveSnapshotAction, deleteSnapshotAction, type FormState } from "../actions";

/**
 * Retire a branch, bring one back, or delete one nothing is filed under.
 *
 * Delete is only rendered for an empty branch, because a branch with runs
 * cannot be deleted at all — the server says so too, and the schema's
 * `onDelete: Restrict` says so underneath that. Presentation is not an
 * authorization boundary; this just avoids offering what cannot happen.
 */
export function SnapshotControls({
  id,
  name,
  runs,
  archived,
}: {
  id: string;
  name: string;
  runs: number;
  archived: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    archived ? unarchive : archiveSnapshotAction,
    {},
  );
  const [deleteState, deleteAction, deleting] = useActionState<FormState, FormData>(
    deleteSnapshotAction,
    {},
  );

  return (
    <div className="flex items-center gap-2">
      <form action={formAction}>
        <input type="hidden" name="id" value={id} />
        {archived ? <input type="hidden" name="unarchive" value="1" /> : null}
        <button
          type="submit"
          className={action}
          disabled={pending}
          title={
            archived
              ? `Bring ${name} back into the pickers`
              : `Retire ${name}, keeping its ${runs} run${runs === 1 ? "" : "s"} readable`
          }
        >
          {archived ? (
            <ArchiveRestore size={14} aria-hidden="true" />
          ) : (
            <Archive size={14} aria-hidden="true" />
          )}
          {pending ? "…" : archived ? "Unarchive" : "Archive"}
        </button>
      </form>

      {runs === 0 ? (
        <form action={deleteAction}>
          <input type="hidden" name="id" value={id} />
          <button type="submit" className={danger} disabled={deleting} title={`Delete ${name}`}>
            <Trash2 size={14} aria-hidden="true" />
            {deleting ? "…" : "Delete"}
          </button>
        </form>
      ) : null}

      {(state.error ?? deleteState.error) ? (
        <p role="alert" className="text-xs text-red-300">
          {state.error ?? deleteState.error}
        </p>
      ) : null}
    </div>
  );
}

/** Archiving and un-archiving are one action apart, so they share a handler. */
function unarchive(previous: FormState, formData: FormData): Promise<FormState> {
  formData.set("unarchive", "1");
  return archiveSnapshotAction(previous, formData);
}
