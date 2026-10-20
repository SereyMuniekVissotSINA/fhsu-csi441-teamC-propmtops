import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CODE_OUTPUT_CONTRACT,
  classifyFiles,
  commitStats,
  describeCommit,
  parseGeneratedFiles,
} from "./code-commits";
import { resolveProvider, runOpenAI } from "./openai-run";

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

test("resolveProvider prefers a local server, falls back to OpenAI, or reports nothing", (t) => {
  const vars = ["LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY", "OPENAI_API_KEY", "OPENAI_MODEL"];
  const saved = Object.fromEntries(vars.map((name) => [name, process.env[name]]));
  t.after(() => {
    for (const name of vars) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });
  for (const name of vars) delete process.env[name];

  assert.equal(resolveProvider(), null);

  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_MODEL = "gpt-test";
  assert.deepEqual(resolveProvider(), { baseUrl: undefined, key: "sk-test", model: "gpt-test" });

  process.env.LLM_BASE_URL = "http://localhost:20128/v1";
  process.env.LLM_MODEL = "openrouter/test:free";
  process.env.LLM_API_KEY = "router-key";
  assert.deepEqual(resolveProvider(), {
    baseUrl: "http://localhost:20128/v1",
    key: "router-key",
    model: "openrouter/test:free",
  });

  // A local server with no key is allowed; a missing model is not.
  delete process.env.LLM_MODEL;
  assert.equal(resolveProvider(), null);
});

test("a local model's code response becomes committable files", async (t) => {
  // The shape a chat-completions server actually returns, run through the same
  // path the generate route uses.
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    assert.match(body.messages[0].content, /its own fenced code block/);
    return Response.json({
      model: "local-model",
      choices: [
        {
          message: {
            content: [
              "Here are the files:",
              "",
              "```ts src/lib/greet.ts",
              'export const greet = (name: string) => `Hi ${name}`;',
              "```",
              "",
              "```ts src/lib/greet.test.ts",
              'import { greet } from "./greet";',
              "```",
              "",
              "Then run:",
              "",
              "```bash",
              "bun test",
              "```",
            ].join("\n"),
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 40, completion_tokens: 60 },
    });
  });

  const result = await runOpenAI(
    `Write a greeting helper.${CODE_OUTPUT_CONTRACT}`,
    "router-key",
    "local-model",
    "http://localhost:20128/v1",
  );
  const files = classifyFiles([], parseGeneratedFiles(result.output));

  assert.deepEqual(
    files.map((file) => [file.path, file.change]),
    [
      ["src/lib/greet.ts", "ADDED"],
      ["src/lib/greet.test.ts", "ADDED"],
    ],
  );
  assert.equal(describeCommit(files), "Add 2 files");
  assert.equal(commitStats(files).added, 2);
});
