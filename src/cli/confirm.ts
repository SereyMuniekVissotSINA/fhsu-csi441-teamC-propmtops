import { createInterface } from "node:readline";

import { CliError } from "./client";

/**
 * Ask a one-line question, offering a default.
 *
 * Used to name a snapshot right after taking one, which is the moment the
 * developer actually knows what the work is called. With no terminal — a hook,
 * a script — there is nobody to ask, so the caller falls back to the default
 * rather than blocking forever on a read that will never come.
 */
export async function ask(question: string, fallback: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY) return fallback;

  const reader = createInterface({ input, output: process.stdout, terminal: true });
  try {
    const answer = await new Promise<string>((resolve) =>
      reader.question(`${question} [${fallback}] `, resolve),
    );
    return answer.trim() || fallback;
  } finally {
    reader.close();
  }
}

/**
 * Ask before overwriting someone's working directory.
 *
 * Restoring a run is the one command here that changes files on disk, so it
 * asks by default. With no terminal to ask on — a hook, a script, `--watch` —
 * there is nothing to prompt, and the caller has to have said `--yes` already;
 * saying so is better than assuming consent.
 */
export async function confirm(question: string): Promise<boolean> {
  const input = process.stdin;
  if (!input.isTTY) {
    throw new CliError(
      "No terminal to confirm on. Re-run with --yes if you mean to overwrite these files.",
    );
  }

  const reader = createInterface({ input, output: process.stdout, terminal: true });
  try {
    const answer = await new Promise<string>((resolve) =>
      reader.question(`${question} [y/N] `, resolve),
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    reader.close();
  }
}
