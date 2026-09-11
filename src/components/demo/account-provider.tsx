"use client";

import Link from "next/link";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ACCOUNT_STORAGE_KEY,
  assertDemoCanEdit,
  demoUsers,
  readAccounts,
  roles,
  updateAccounts,
  writeAccounts,
  type AccountAction,
  type DemoAccounts,
  type DemoRole,
  type DemoUser,
} from "@/lib/demo-accounts";

const button =
  "rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-emerald-400 disabled:opacity-40";
const field =
  "rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-emerald-400";
type AccountContext = {
  user: DemoUser;
  workspace: { id: string; name: string; role: DemoRole };
  canEdit: boolean;
  canManage: boolean;
  assertCanEdit: () => void;
};
const Context = createContext<AccountContext | null>(null);
export function useDemoAccount() {
  const value = useContext(Context);
  if (!value)
    throw new Error("useDemoAccount requires a signed-in DemoAccountProvider.");
  return value;
}
export function DemoAccountProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoAccounts | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [manage, setManage] = useState(false);
  const [name, setName] = useState("");
  const [reveal, setReveal] = useState(false);
  const snapshot = useRef<string | null>(null);
  useEffect(() => {
    const load = () => {
      try {
        const saved = readAccounts(window.localStorage);
        snapshot.current = saved.snapshot;
        setState(saved.state);
        setError("");
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Browser storage is unavailable. Enable local storage and reload to use this demo.",
        );
      }
    };
    const timer = setTimeout(load, 0);
    const changed = (event: StorageEvent) => {
      if (event.key === ACCOUNT_STORAGE_KEY || event.key === null) {
        // Keep the active editor mounted; reject stale writes and ask the user to reload.
        setError(
          "Demo accounts changed in another tab. Reload to use the latest session and permissions.",
        );
      }
    };
    window.addEventListener("storage", changed);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("storage", changed);
    };
  }, []);
  const user = demoUsers.find((u) => u.id === state?.userId);
  const workspace = state?.workspaces.find((w) => w.id === state.workspaceId);
  const membership = workspace?.members.find((m) => m.userId === user?.id);
  const canManage = membership?.role === "OWNER";
  function commit(action: AccountAction) {
    if (!state) return false;
    const changesContext =
      action.type === "switch" ||
      action.type === "signOut" ||
      action.type === "signIn" ||
      action.type === "create" ||
      (action.type === "member" && action.userId === state.userId);
    if (
      changesContext &&
      !window.dispatchEvent(
        new Event("promptops:before-context-change", { cancelable: true }),
      )
    )
      return false;
    try {
      const next = updateAccounts(state, action);
      snapshot.current = writeAccounts(
        window.localStorage,
        next,
        snapshot.current,
      );
      setState(next);
      setError("");
      setReveal(false);
      setNotice("Demo changes saved in this browser.");
      return true;
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save. Browser storage may be full or unavailable; no changes were applied.",
      );
      return false;
    }
  }
  const createForm = (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (
          commit({
            type: "create",
            name,
            id: crypto.randomUUID(),
            apiKey: `demo_${crypto.randomUUID()}`,
          })
        )
          setName("");
      }}
    >
      <label className="grid gap-1 text-sm text-zinc-300">
        New workspace
        <input
          className={field}
          required
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Product team"
        />
      </label>
      <button className={button} type="submit">
        Create workspace
      </button>
    </form>
  );
  return (
    <div className="min-h-screen bg-[#080808]">
      <section
        id="auth-workspace"
        aria-label="Demo authentication and workspace"
        className="border-b border-zinc-800 bg-zinc-950 text-zinc-100"
      >
        <div className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Link
                href="/"
                onClick={(event) => {
                  if (
                    !window.dispatchEvent(
                      new Event("promptops:before-context-change", {
                        cancelable: true,
                      }),
                    )
                  )
                    event.preventDefault();
                }}
                className="text-sm text-emerald-400 hover:underline"
              >
                ← PromptOps home
              </Link>
              <h1 className="mt-2 text-xl font-semibold">Auth & workspace</h1>
              <p className="mt-1 text-sm text-zinc-400">
                Simulated identities, roles and keys. Everything stays in this
                browser; no real authentication or invitations.
              </p>
            </div>
            {user && (
              <button
                className={button}
                onClick={() => commit({ type: "signOut" })}
              >
                Sign out of demo
              </button>
            )}
          </div>
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-amber-800 bg-amber-950/40 p-3 text-sm text-amber-200"
            >
              {error}{" "}
              <button
                className="underline"
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
              <button
                className="ml-3 underline"
                onClick={() => {
                  if (
                    !window.confirm(
                      "Reset demo identities, memberships and keys? All prompt libraries will be preserved.",
                    )
                  )
                    return;
                  if (
                    !window.dispatchEvent(
                      new Event("promptops:before-context-change", {
                        cancelable: true,
                      }),
                    )
                  )
                    return;
                  try {
                    window.localStorage.removeItem(ACCOUNT_STORAGE_KEY);
                    const saved = readAccounts(window.localStorage);
                    snapshot.current = saved.snapshot;
                    setState(saved.state);
                    setError("");
                    setManage(false);
                    setReveal(false);
                    setNotice(
                      "Demo account settings reset. Prompt libraries were preserved.",
                    );
                  } catch {
                    setError(
                      "Browser storage is unavailable. Enable local storage, then reload. Your prompt libraries have not been changed.",
                    );
                  }
                }}
              >
                Reset demo account settings
              </button>
            </div>
          )}
          {notice && (
            <p role="status" className="text-sm text-emerald-300">
              {notice}
            </p>
          )}
          {!state && !error && (
            <p role="status" className="text-sm text-zinc-400">
              Loading saved demo session…
            </p>
          )}
          {state && !user && (
            <div className="grid gap-3 sm:grid-cols-3">
              {demoUsers.map((identity) => (
                <button
                  key={identity.id}
                  className={`${button} p-4 text-left`}
                  onClick={() =>
                    commit({ type: "signIn", userId: identity.id })
                  }
                >
                  <span className="block font-semibold">
                    Continue as {identity.name}
                  </span>
                  <span className="mt-1 block text-xs text-zinc-400">
                    {identity.email}
                  </span>
                  <span className="mt-1 block text-xs text-zinc-400">
                    Personal workspace:{" "}
                    {state.workspaces
                      .find((w) => w.id === "personal")
                      ?.members.find((m) => m.userId === identity.id)
                      ?.role.toLowerCase() ?? "no access"}
                  </span>
                  <span className="mt-3 block text-xs text-emerald-300">
                    {
                      state.workspaces.filter((w) =>
                        w.members.some((m) => m.userId === identity.id),
                      ).length
                    }{" "}
                    workspace memberships
                  </span>
                </button>
              ))}
            </div>
          )}
          {user && state && (
            <>
              <div className="flex flex-wrap items-end gap-4">
                <p className="text-sm">
                  <span className="block text-xs text-zinc-500">
                    Demo identity
                  </span>
                  {user.name}
                </p>
                <label className="grid gap-1 text-xs text-zinc-400">
                  Active workspace
                  <select
                    className={field}
                    value={membership ? workspace!.id : ""}
                    onChange={(e) => {
                      if (
                        commit({ type: "switch", workspaceId: e.target.value })
                      )
                        setManage(false);
                    }}
                  >
                    <option value="" disabled>
                      Select a workspace
                    </option>
                    {state.workspaces
                      .filter((w) =>
                        w.members.some((m) => m.userId === user.id),
                      )
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                  </select>
                </label>
                {membership && (
                  <span className="rounded-full border border-emerald-900 px-3 py-2 text-xs text-emerald-300">
                    {membership.role}
                  </span>
                )}
                <button
                  className={button}
                  aria-expanded={manage}
                  aria-controls="workspace-settings"
                  onClick={() => setManage(!manage)}
                >
                  {manage ? "Close workspace settings" : "Workspace settings"}
                </button>
              </div>
              {!membership && (
                <div className="space-y-3 rounded-lg border border-zinc-800 p-4">
                  <p>
                    You have no active workspace membership. Create a workspace
                    to get started.
                  </p>
                  {!manage && createForm}
                </div>
              )}
              {manage && (
                <div
                  id="workspace-settings"
                  className="grid gap-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 lg:grid-cols-2"
                >
                  <div className="space-y-4">
                    {createForm}
                    {workspace && membership && (
                      <>
                        <h2 className="font-semibold">Workspace members</h2>
                        <p className="text-xs text-zinc-400">
                          Owners manage members and keys; editors save prompts;
                          viewers browse and preview.
                        </p>
                        <ul className="space-y-3">
                          {workspace.members.map((member) => (
                            <li
                              key={member.userId}
                              className="flex flex-wrap items-center gap-2 text-sm"
                            >
                              <span className="min-w-28 flex-1">
                                {
                                  demoUsers.find((u) => u.id === member.userId)
                                    ?.name
                                }
                              </span>
                              <select
                                aria-label={`Role for ${member.userId}`}
                                className={field}
                                disabled={!canManage}
                                value={member.role}
                                onChange={(e) =>
                                  commit({
                                    type: "member",
                                    userId: member.userId,
                                    role: e.target.value as DemoRole,
                                  })
                                }
                              >
                                {roles.map((role) => (
                                  <option key={role}>{role}</option>
                                ))}
                              </select>
                              {canManage && (
                                <button
                                  className={button}
                                  aria-label={`Remove ${member.userId}`}
                                  onClick={() =>
                                    commit({
                                      type: "member",
                                      userId: member.userId,
                                      role: null,
                                    })
                                  }
                                >
                                  Remove
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                        {canManage &&
                          demoUsers
                            .filter(
                              (u) =>
                                !workspace.members.some(
                                  (m) => m.userId === u.id,
                                ),
                            )
                            .map((u) => (
                              <button
                                key={u.id}
                                className={`${button} mr-2`}
                                onClick={() =>
                                  commit({
                                    type: "member",
                                    userId: u.id,
                                    role: "EDITOR",
                                  })
                                }
                              >
                                Add {u.name} as editor
                              </button>
                            ))}
                      </>
                    )}
                  </div>
                  {workspace && membership && (
                    <div className="space-y-3">
                      <h2 className="font-semibold">Demo API key</h2>
                      <p className="text-sm text-zinc-400">
                        A local placeholder to try key management. It cannot
                        authenticate API requests.
                      </p>
                      {canManage ? (
                        <>
                          <code className="block break-all rounded-lg bg-zinc-950 p-3 text-sm text-emerald-300">
                            {reveal
                              ? workspace.apiKey
                              : "demo_••••••••••••••••"}
                          </code>
                          <div className="flex flex-wrap gap-2">
                            <button
                              className={button}
                              onClick={() => setReveal(!reveal)}
                            >
                              {reveal ? "Hide key" : "Reveal key"}
                            </button>
                            <button
                              className={button}
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(
                                    workspace.apiKey,
                                  );
                                  setNotice("Demo key copied.");
                                } catch {
                                  setError(
                                    "Clipboard is unavailable. Reveal the key and copy it manually.",
                                  );
                                }
                              }}
                            >
                              Copy key
                            </button>
                            <button
                              className={button}
                              onClick={() =>
                                commit({
                                  type: "rotate",
                                  apiKey: `demo_${crypto.randomUUID()}`,
                                })
                              }
                            >
                              Rotate demo key
                            </button>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-zinc-500">
                          Only owners can manage the demo key.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </section>
      {user && workspace && membership && (
        <Context.Provider
          key={`${user.id}:${workspace.id}:${membership.role}`}
          value={{
            user,
            workspace: {
              id: workspace.id,
              name: workspace.name,
              role: membership.role,
            },
            canEdit: membership.role !== "VIEWER",
            canManage,
            assertCanEdit: () =>
              assertDemoCanEdit(window.localStorage, user.id, workspace.id),
          }}
        >
          {children}
        </Context.Provider>
      )}
    </div>
  );
}
