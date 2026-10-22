import {
  DEMO_STORAGE_KEY,
  demoStoreSchema,
  type DemoPrompt,
} from "./demo-prompts";

export function demoWorkspaceStorageKey(workspaceId = "personal") {
  // Preserve the original demo library as the first workspace.
  return workspaceId === "personal"
    ? DEMO_STORAGE_KEY
    : `${DEMO_STORAGE_KEY}.workspace.${encodeURIComponent(workspaceId)}`;
}

export function readDemo(
  storage: Pick<Storage, "getItem">,
  workspaceId = "personal",
) {
  const snapshot = storage.getItem(demoWorkspaceStorageKey(workspaceId));
  if (snapshot === null) return { snapshot, prompts: null };
  try {
    return {
      snapshot,
      prompts: demoStoreSchema.parse(JSON.parse(snapshot)).prompts,
    };
  } catch {
    throw new Error(
      "The saved demo data could not be read. Reset the demo to start over, or continue without saving. Your existing data has not been overwritten.",
    );
  }
}

export function writeDemo(
  storage: Pick<Storage, "getItem" | "setItem">,
  prompts: DemoPrompt[],
  snapshot: string | null,
  workspaceId = "personal",
) {
  const key = demoWorkspaceStorageKey(workspaceId);
  if (storage.getItem(key) !== snapshot) {
    throw new Error(
      "This workspace changed in another tab. Reload the page before saving to avoid overwriting those changes.",
    );
  }
  const next = JSON.stringify(
    demoStoreSchema.parse({ schemaVersion: 1, prompts }),
  );
  try {
    storage.setItem(key, next);
  } catch {
    throw new Error(
      "Your browser could not save this change. Local storage may be full or disabled. Your edits are still here; free some space and try again.",
    );
  }
  return next;
}
