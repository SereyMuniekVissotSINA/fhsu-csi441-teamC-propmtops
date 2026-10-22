import { z } from "zod";

export const ACCOUNT_STORAGE_KEY = "promptops.demo.accounts.v1";
export const demoUsers = [
  { id: "alex", name: "Alex Morgan", email: "alex@example.test" },
  { id: "sam", name: "Sam Rivera", email: "sam@example.test" },
  { id: "jordan", name: "Jordan Lee", email: "jordan@example.test" },
] as const;
export const roles = ["OWNER", "EDITOR", "VIEWER"] as const;
export type DemoRole = (typeof roles)[number];
const memberSchema = z.object({
  userId: z.enum(["alex", "sam", "jordan"]),
  role: z.enum(roles),
});
const workspaceSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(60),
    members: z.array(memberSchema).min(1),
    apiKey: z.string().startsWith("demo_"),
  })
  .refine(
    (w) =>
      w.members.some((m) => m.role === "OWNER") &&
      new Set(w.members.map((m) => m.userId)).size === w.members.length,
    "Every workspace requires unique members and an owner.",
  );
export const accountSchema = z
  .object({
    version: z.literal(1),
    userId: z.enum(["alex", "sam", "jordan"]).nullable(),
    workspaceId: z.string().nullable(),
    workspaces: z.array(workspaceSchema).min(1),
  })
  .refine(
    (s) => new Set(s.workspaces.map((w) => w.id)).size === s.workspaces.length,
    "Workspace IDs must be unique.",
  );
export type DemoAccounts = z.infer<typeof accountSchema>;
export type DemoUser = (typeof demoUsers)[number];
export function initialAccounts(): DemoAccounts {
  return {
    version: 1,
    userId: null,
    workspaceId: "personal",
    workspaces: [
      {
        id: "personal",
        name: "Personal workspace",
        members: [
          { userId: "alex", role: "OWNER" },
          { userId: "sam", role: "EDITOR" },
          { userId: "jordan", role: "VIEWER" },
        ],
        apiKey: "demo_personal_preview_only",
      },
      {
        id: "research",
        name: "Research lab",
        members: [
          { userId: "sam", role: "OWNER" },
          { userId: "alex", role: "VIEWER" },
        ],
        apiKey: "demo_research_preview_only",
      },
    ],
  };
}
export type AccountAction =
  | { type: "signIn"; userId: DemoUser["id"] }
  | { type: "signOut" }
  | { type: "switch"; workspaceId: string }
  | { type: "create"; id: string; name: string; apiKey: string }
  | { type: "member"; userId: DemoUser["id"]; role: DemoRole | null }
  | { type: "rotate"; apiKey: string };
export function updateAccounts(
  previous: DemoAccounts,
  action: AccountAction,
): DemoAccounts {
  const state = accountSchema.parse(previous);
  if (action.type === "signOut") return { ...state, userId: null };
  if (action.type === "signIn") {
    const available = state.workspaces.filter((w) =>
      w.members.some((m) => m.userId === action.userId),
    );
    return accountSchema.parse({
      ...state,
      userId: action.userId,
      workspaceId:
        available.find((w) => w.id === state.workspaceId)?.id ??
        available[0]?.id ??
        null,
    });
  }
  if (!state.userId) throw new Error("Choose a demo identity first.");
  if (action.type === "create") {
    return accountSchema.parse({
      ...state,
      workspaceId: action.id,
      workspaces: [
        ...state.workspaces,
        {
          id: action.id,
          name: action.name.trim(),
          apiKey: action.apiKey,
          members: [{ userId: state.userId, role: "OWNER" }],
        },
      ],
    });
  }
  if (action.type === "switch") {
    if (
      !state.workspaces.some(
        (w) =>
          w.id === action.workspaceId &&
          w.members.some((m) => m.userId === state.userId),
      )
    )
      throw new Error("You are not a member of this workspace.");
    return { ...state, workspaceId: action.workspaceId };
  }
  const workspace = state.workspaces.find((w) => w.id === state.workspaceId);
  if (
    !workspace ||
    workspace.members.find((m) => m.userId === state.userId)?.role !== "OWNER"
  )
    throw new Error("Only a workspace owner can manage members or demo keys.");
  if (action.type === "rotate") workspace.apiKey = action.apiKey;
  else {
    const members = workspace.members.filter((m) => m.userId !== action.userId);
    if (action.role) members.push({ userId: action.userId, role: action.role });
    if (!members.some((m) => m.role === "OWNER"))
      throw new Error(
        "Assign another owner before removing or changing the last owner.",
      );
    workspace.members = members;
    if (!members.some((m) => m.userId === state.userId))
      state.workspaceId =
        state.workspaces.find((w) =>
          w.members.some((m) => m.userId === state.userId),
        )?.id ?? null;
  }
  return accountSchema.parse(state);
}
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
export function readAccounts(storage: Storage): {
  state: DemoAccounts;
  snapshot: string | null;
} {
  const snapshot = storage.getItem(ACCOUNT_STORAGE_KEY);
  if (snapshot === null) return { state: initialAccounts(), snapshot };
  try {
    return { state: accountSchema.parse(JSON.parse(snapshot)), snapshot };
  } catch {
    throw new Error(
      "Saved demo account data is invalid. It has been preserved. Restore it or clear only this demo account key in browser storage, then reload.",
    );
  }
}
export function writeAccounts(
  storage: Storage,
  state: DemoAccounts,
  snapshot: string | null,
): string {
  if (storage.getItem(ACCOUNT_STORAGE_KEY) !== snapshot)
    throw new Error(
      "Demo accounts changed in another tab. Reload before trying again.",
    );
  const next = JSON.stringify(accountSchema.parse(state));
  storage.setItem(ACCOUNT_STORAGE_KEY, next);
  return next;
}
export function assertDemoCanEdit(
  storage: Storage,
  userId: string,
  workspaceId: string,
): void {
  const { state } = readAccounts(storage);
  const role = state.workspaces
    .find((w) => w.id === workspaceId)
    ?.members.find((m) => m.userId === userId)?.role;
  if (
    state.userId !== userId ||
    state.workspaceId !== workspaceId ||
    (role !== "OWNER" && role !== "EDITOR")
  )
    throw new Error(
      "Your demo session or workspace access changed. Reload before editing.",
    );
}
