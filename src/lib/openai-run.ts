import { z } from "zod";

const responseSchema = z.object({
  model: z.string(),
  status: z.string(),
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({
      type: z.string(),
      text: z.string().optional(),
      refusal: z.string().optional(),
    })).optional(),
  })),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).nullish(),
});

// The same two-provider resolution every run route needs: a local 9Router (or
// any OpenAI-compatible server) when LLM_BASE_URL is set, otherwise OpenAI
// directly. Returns null when neither is configured.
export function resolveProvider(): { baseUrl?: string; key: string; model: string } | null {
  const baseUrl = process.env.LLM_BASE_URL?.trim();
  const key = (baseUrl ? process.env.LLM_API_KEY : process.env.OPENAI_API_KEY)?.trim() ?? "";
  const model = (baseUrl ? process.env.LLM_MODEL : process.env.OPENAI_MODEL)?.trim();
  if ((!baseUrl && !key) || !model) return null;
  return { baseUrl, key, model };
}

export const PROVIDER_SETUP_MESSAGE =
  "Configure LLM_MODEL for 9Router, or OPENAI_API_KEY and OPENAI_MODEL for direct OpenAI, then restart the development server.";

/**
 * Perform the request, turning a connection failure into an `LLM`-prefixed
 * message the routes are willing to pass through. A timeout is rethrown
 * untouched so callers can still answer 504.
 */
async function send(baseUrl: string | undefined, init: RequestInit): Promise<Response> {
  const url = baseUrl
    ? `${baseUrl.replace(/\/$/, "")}/chat/completions`
    : "https://api.openai.com/v1/responses";
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw error;
    throw new Error(
      baseUrl
        ? "LLM server is not reachable. Start your local model server (LLM_BASE_URL), or unset it to call OpenAI directly."
        : "LLM provider is not reachable. Check your network connection.",
    );
  }
}

export async function runOpenAI(input: string, apiKey: string, model: string, baseUrl?: string, options?: { maxOutputTokens?: number }) {
  const started = Date.now();
  const response = await send(baseUrl, {
    method: "POST",
    headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), "Content-Type": "application/json" },
    body: JSON.stringify(baseUrl
      ? { model, messages: [{ role: "user", content: input }], max_tokens: options?.maxOutputTokens ?? 4096, stream: false }
      : { model, input, max_output_tokens: options?.maxOutputTokens ?? 1024, store: false }),
    signal: AbortSignal.timeout(60_000),
    cache: "no-store",
  });
  if (!response.ok) {
    // Do not forward provider payloads, which can include request details.
    throw new Error(response.status === 429
      ? "LLM quota or rate limit reached. Check your provider's limits."
      : response.status === 401
        ? "LLM authentication failed. Check LLM_API_KEY for 9Router or OPENAI_API_KEY for direct OpenAI."
        : `LLM request failed (HTTP ${response.status}). Check your model access and server configuration.`);
  }
  if (baseUrl) {
    const data = z.object({
      model: z.string(),
      choices: z.array(z.object({
        message: z.object({ content: z.string().nullable(), refusal: z.string().nullish() }),
        finish_reason: z.string().nullable(),
      })).min(1),
      usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).nullish(),
    }).parse(await response.json());
    const choice = data.choices[0];
    return { output: choice.message.content ?? choice.message.refusal ?? "", model: data.model,
      incomplete: choice.finish_reason !== "stop" || !!choice.message.refusal, elapsedMs: Date.now() - started,
      usage: data.usage ? { input_tokens: data.usage.prompt_tokens, output_tokens: data.usage.completion_tokens } : null };
  }
  const data = responseSchema.parse(await response.json());
  if (data.status !== "completed" && data.status !== "incomplete") {
    throw new Error("OpenAI did not complete this request. Try again.");
  }
  const output = data.output.flatMap((item) => item.type === "message" ? item.content ?? [] : [])
    .map((part) => part.type === "output_text" ? part.text ?? "" : part.refusal ?? "")
    .join("\n");
  return { output, model: data.model, incomplete: data.status === "incomplete", usage: data.usage, elapsedMs: Date.now() - started };
}
