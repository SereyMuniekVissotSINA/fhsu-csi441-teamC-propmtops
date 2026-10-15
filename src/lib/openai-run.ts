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

export async function runOpenAI(input: string, apiKey: string, model: string, baseUrl?: string) {
  const started = Date.now();
  const response = await fetch(baseUrl ? `${baseUrl.replace(/\/$/, "")}/chat/completions` : "https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), "Content-Type": "application/json" },
    body: JSON.stringify(baseUrl
      ? { model, messages: [{ role: "user", content: input }], max_tokens: 4096, stream: false }
      : { model, input, max_output_tokens: 1024, store: false }),
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
      incomplete: choice.finish_reason === "length", elapsedMs: Date.now() - started,
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
