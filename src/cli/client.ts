import { loadConfig } from "./config";

// The HTTP layer. Every route answers `{ error }` with a meaningful status, so
// the CLI's job is to surface that text rather than invent its own wording.

export class CliError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export type Client = {
  url: string;
  hasKey: boolean;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
};

export function createClient(overrides: { url?: string; key?: string } = {}): Client {
  const config = loadConfig();
  const url = overrides.url ?? config.url;
  const key = overrides.key ?? config.key;

  return {
    url,
    hasKey: Boolean(key),
    async request<T>(path: string, init: RequestInit = {}): Promise<T> {
      if (!key) {
        throw new CliError(
          "No API key. Run `pops auth login --key pops_…`, or set POPS_API_KEY.\n" +
            "Create a key in the web app: workspace settings → API keys (owners only).",
        );
      }

      let response: Response;
      try {
        response = await fetch(`${url}${path}`, {
          ...init,
          headers: {
            Authorization: `Bearer ${key}`,
            ...(init.body ? { "Content-Type": "application/json" } : {}),
            ...init.headers,
          },
          // Generation can legitimately take a while; the server caps the model
          // call at 60 seconds and we allow for the round trip around it.
          signal: AbortSignal.timeout(120_000),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
          throw new CliError("Request timed out.");
        }
        throw new CliError(
          `Cannot reach ${url}. Is the app running? Start it with \`bun run dev\`.`,
        );
      }

      const text = await response.text();
      const data = text ? safeJson(text) : null;

      if (!response.ok) {
        const message =
          data && typeof data === "object" && "error" in data
            ? String((data as { error: unknown }).error)
            : `Request failed (HTTP ${response.status}).`;
        throw new CliError(message, response.status);
      }

      return data as T;
    },
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // An HTML error page, usually: a route that 404'd before reaching a handler.
    return null;
  }
}
