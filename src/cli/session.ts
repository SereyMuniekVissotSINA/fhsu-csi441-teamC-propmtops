import { createInterface } from "node:readline";

import { CliError } from "./client";

// Signing in from the terminal.
//
// Minting a key needs OWNER, and `requireMember` needs a browser session — that
// is deliberate: a workspace key acts as an EDITOR and must never be able to
// mint another key (see the escalation note in `src/lib/api-auth.ts`). So the
// CLI cannot ask a key for permission to make a key; it has to sign in as a
// person instead.
//
// Rather than add a key-minting endpoint that trusts a password, this does
// exactly what the login form does: fetch a CSRF token, post credentials to
// Auth.js's own callback, and keep the session cookie it hands back. No new
// server surface, and no second implementation of the rules.

/**
 * Auth.js names the session cookie `authjs.session-token`, prefixes it with
 * `__Secure-` over HTTPS, and splits it into `.0`, `.1`, … when a large JWT
 * outgrows one cookie. All three spellings are the session.
 */
const SESSION_COOKIE = /^(?:__Secure-)?authjs\.session-token(?:\.\d+)?$/;

/** Cookie name → value, in the order the server set them. */
export type Jar = Map<string, string>;

/**
 * Absorb `Set-Cookie` headers into the jar, dropping the attributes we have no
 * use for. A cookie cleared with an empty value is removed rather than stored,
 * so a failed sign-in does not leave `session-token=` behind looking like one.
 */
export function absorb(jar: Jar, setCookies: string[]): Jar {
  for (const header of setCookies) {
    const [pair] = header.split(";");
    const at = pair.indexOf("=");
    if (at <= 0) continue;
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1).trim();
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
  return jar;
}

export function cookieHeader(jar: Jar): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

export function hasSessionCookie(jar: Jar): boolean {
  return [...jar.keys()].some((name) => SESSION_COOKIE.test(name));
}

/** Read `Set-Cookie` as a list. One header can carry several cookies. */
function setCookies(response: Response): string[] {
  return response.headers.getSetCookie?.() ?? [];
}

/**
 * Exchange an email and password for a session cookie.
 *
 * The password is sent to the app over whatever transport its URL names, so it
 * is as safe as the app's own login page and no safer: over plain HTTP to a
 * remote host it travels in the clear. Localhost, which is what this project
 * runs on, never leaves the machine.
 */
export async function passwordSignIn(options: {
  url: string;
  email: string;
  password: string;
}): Promise<string> {
  const { url, email, password } = options;
  const jar: Jar = new Map();

  const csrf = await fetchJson(`${url}/api/auth/csrf`, jar);
  const csrfToken = typeof csrf?.csrfToken === "string" ? csrf.csrfToken : null;
  if (!csrfToken) {
    throw new CliError(`${url} did not answer with a CSRF token. Is that a Prompt Ops app?`);
  }

  let response: Response;
  try {
    response = await fetch(`${url}/api/auth/callback/credentials`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader(jar),
        // Auth.js compares this against its own host, and the token above
        // against its cookie. Both have to look like the login form.
        Origin: url,
        // Answer with JSON instead of a 302 to the dashboard, which we would
        // only have to follow and discard.
        "X-Auth-Return-Redirect": "1",
      },
      body: new URLSearchParams({ csrfToken, email, password, callbackUrl: url }),
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new CliError("Sign-in timed out.");
    }
    throw new CliError(`Cannot reach ${url}. Is the app running? Start it with \`bun run dev\`.`);
  }

  absorb(jar, setCookies(response));

  // Auth.js answers a rejected password with a redirect back to the login page
  // and no session cookie, not with a 401 — so the cookie is the only reliable
  // signal, and its absence means the credentials were refused.
  if (!hasSessionCookie(jar)) {
    if (response.status >= 500) {
      throw new CliError("The app errored while signing in. Check its console.");
    }
    throw new CliError(
      "That email and password were not accepted.\n" +
        "The same pair should work on the app's login page.",
    );
  }

  return cookieHeader(jar);
}

async function fetchJson(target: string, jar: Jar): Promise<Record<string, unknown> | null> {
  let response: Response;
  try {
    response = await fetch(target, { signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new CliError(
      `Cannot reach ${new URL(target).origin}. Is the app running? Start it with \`bun run dev\`.`,
    );
  }
  absorb(jar, setCookies(response));
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Ask for a password without echoing it.
 *
 * Reading it from a flag would leave it in the shell history, and in `ps` while
 * the command runs, so an interactive prompt is the default and `--password` is
 * only there for scripts that already hold the value in a variable.
 */
export async function askPassword(prompt: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY) {
    throw new CliError(
      "No terminal to ask for a password on. Pass --password, or set POPS_PASSWORD.",
    );
  }

  process.stdout.write(prompt);
  const reader = createInterface({ input, output: process.stdout, terminal: true });

  // readline echoes what it reads; muting the output stream it writes through
  // is how a password prompt stays blank. The newline is ours to print.
  const muted = reader as unknown as { _writeToOutput: (text: string) => void };
  muted._writeToOutput = () => {};

  try {
    return await new Promise<string>((resolve) => reader.question("", resolve));
  } finally {
    reader.close();
    process.stdout.write("\n");
  }
}
