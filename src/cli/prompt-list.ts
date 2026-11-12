import { CliError, type Client } from "./client";
import type { PromptSummary } from "./types";

// The API keeps each response bounded; resolving titles must still inspect all
// pages, otherwise a duplicate title on an older page looks unambiguous.
const PAGE_SIZE = 50;

export async function fetchAllPrompts(
  client: Pick<Client, "request">,
  workspaceId?: string,
): Promise<PromptSummary[]> {
  const prompts = new Map<string, PromptSummary>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const query = new URLSearchParams({ offset: String(offset) });
    if (workspaceId) query.set("workspaceId", workspaceId);
    const page = await client.request<PromptSummary[]>(`/api/prompts?${query}`);
    const previousSize = prompts.size;
    for (const prompt of page) prompts.set(prompt.id, prompt);
    if (page.length < PAGE_SIZE) return [...prompts.values()];
    // An older server ignores offset. Do not loop forever or resolve against
    // an incomplete list that could select the wrong prompt.
    if (prompts.size === previousSize) {
      throw new CliError("Prompt pagination did not advance. Update the server and try again.");
    }
  }
}
