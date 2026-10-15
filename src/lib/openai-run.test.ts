import { test } from "node:test";
import assert from "node:assert/strict";
import { runOpenAI } from "./openai-run";

test("OpenAI request limits output, disables storage, and collects message text", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    assert.equal(body.store, false);
    assert.equal(body.max_output_tokens, 1024);
    assert.equal(body.input, "Hello");
    assert.equal(body.model, "test-model");
    return Response.json({ model: "test-model", status: "incomplete", output: [
      { type: "reasoning" },
      { type: "message", content: [{ type: "output_text", text: "Hello back" }] },
    ], usage: { input_tokens: 2, output_tokens: 3 } });
  });
  const result = await runOpenAI("Hello", "fake-key", "test-model");
  assert.equal(result.output, "Hello back");
  assert.equal(result.incomplete, true);
  assert.equal(result.usage?.output_tokens, 3);
});

test("provider error details are not exposed", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "private request details" }, { status: 429 }));
  await assert.rejects(runOpenAI("Hello", "fake-key", "test-model"), /LLM quota or rate limit reached/);
});

test("9Router uses chat completions and maps usage to the editor response", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "http://localhost:20128/v1/chat/completions");
    assert.equal((options.headers as Record<string, string>).Authorization, "Bearer router-key");
    const body = JSON.parse(options.body as string);
    assert.deepEqual(body.messages, [{ role: "user", content: "Hello" }]);
    assert.equal(body.model, "openrouter/test:free");
    assert.equal(body.stream, false);
    assert.equal(body.max_tokens, 4096);
    return Response.json({ model: body.model, choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1 } });
  });
  const result = await runOpenAI("Hello", "router-key", "openrouter/test:free", "http://localhost:20128/v1/");
  assert.equal(result.output, "OK");
  assert.equal(result.usage?.input_tokens, 3);
  assert.equal(result.incomplete, false);
});
