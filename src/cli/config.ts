import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Where the CLI keeps its credentials.
//
// A workspace key is a credential, so the file is written with owner-only
// permissions and lives outside the repository — never in `.env`, which is
// shared with the web app and read by the whole framework.

export type CliConfig = { url: string; key?: string };

export const DEFAULT_URL = "http://localhost:3000";

export function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(base, "promptops", "config.json");
}

/**
 * Settings, with environment variables taking precedence over the file so a
 * script or CI job can point at another instance without rewriting it.
 */
export function loadConfig(): CliConfig {
  const stored = readStored();
  return {
    url: stripTrailingSlash(process.env.POPS_URL?.trim() || stored.url || DEFAULT_URL),
    key: process.env.POPS_API_KEY?.trim() || stored.key,
  };
}

function readStored(): Partial<CliConfig> {
  try {
    const parsed = JSON.parse(readFileSync(configPath(), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const { url, key } = parsed as Record<string, unknown>;
    return {
      url: typeof url === "string" ? url : undefined,
      key: typeof key === "string" ? key : undefined,
    };
  } catch {
    // No config yet, or unreadable: fall back to defaults rather than failing.
    return {};
  }
}

export function saveConfig(config: CliConfig): string {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // writeFileSync only applies the mode when creating the file, so an existing
  // one keeps whatever it had until we say otherwise.
  chmodSync(path, 0o600);
  return path;
}

export function clearConfig(): boolean {
  try {
    rmSync(configPath());
    return true;
  } catch {
    return false;
  }
}

export function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Keys are secrets: show enough to tell two apart and no more. */
export function maskKey(key: string): string {
  return key.length <= 12 ? `${key.slice(0, 6)}…` : `${key.slice(0, 10)}…${key.slice(-4)}`;
}
