export type PromptSnapshot = { title: string; body: string; tags: string };
export type PromptHistoryVersion = PromptSnapshot & {
  id: string; note: string; createdAt: string; authorName: string | null;
};
export type PromptDraft = PromptSnapshot & { note: string };

export function loadPromptDraft(version: PromptSnapshot): PromptDraft {
  return { title: version.title, body: version.body, tags: version.tags, note: "" };
}

export function draftAfterSave(draft: PromptDraft, result: { success?: boolean; error?: string }): PromptDraft {
  return result.success && !result.error ? { ...draft, body: "", note: "" } : draft;
}

export const snapshotFields = ["title", "body", "tags"] as const;
export function changedPromptFields(before: PromptSnapshot, after: PromptSnapshot) {
  return snapshotFields.filter(field => before[field] !== after[field]);
}

export type DiffLine = { kind: "same" | "removed" | "added"; text: string };

export function promptLineDiff(before: string, after: string): { lines: DiffLine[]; coarse: boolean } {
  const a = before.split("\n");
  const b = after.split("\n");
  if (before === after) return { lines: a.map(text => ({ kind: "same", text })), coarse: false };
  // Bound the work for old prompts, which do not have a storage length limit.
  if (a.length * b.length > 250_000) return {
    lines: [...a.map(text => ({ kind: "removed" as const, text })), ...b.map(text => ({ kind: "added" as const, text }))],
    coarse: true,
  };
  const width = b.length + 1;
  const lengths = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i * width + j] = a[i] === b[j]
        ? 1 + lengths[(i + 1) * width + j + 1]
        : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ kind: "same", text: a[i++] });
      j++;
    } else if (i < a.length && (j === b.length || lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])) {
      lines.push({ kind: "removed", text: a[i++] });
    } else {
      lines.push({ kind: "added", text: b[j++] });
    }
  }
  return { lines, coarse: false };
}
