"use client";

import { useState } from "react";
import { FILE_ACCEPT, FILE_HELP, validateUploadSelection } from "@/lib/file-policy";
import { field } from "@/lib/ui";

export function FileUploadField({ disabled = false }: { disabled?: boolean }) {
  const [error, setError] = useState("");
  return <label className="block space-y-2 text-sm">
    <span className="font-medium text-zinc-200">Attach files (optional)</span>
    <input type="file" name="files" accept={FILE_ACCEPT} multiple disabled={disabled} className={field}
      onChange={event => {
        const message = validateUploadSelection(Array.from(event.target.files ?? [])) ?? "";
        setError(message);
        event.target.setCustomValidity(message);
      }} />
    <span className="block text-xs text-zinc-400">{FILE_HELP} Excel revisions contain literal cell values; formulas become their displayed/cached values.</span>
    {error ? <span role="alert" className="block text-red-400">{error}</span> : null}
  </label>;
}
