import test from "node:test";
import assert from "node:assert/strict";
import { buildPromptGraph } from "./prompt-graph";
import { demoSamples } from "./demo-prompts";

test("shared tags form one hub and versions remain attached to their own prompt", () => {
  const prompts = demoSamples.slice(0, 2).map((prompt) => ({ ...prompt, versions: prompt.versions.map((version) => ({ ...version, tags: "Shared, shared", body: "Use {{topic}} and {{topic}}" })) }));
  const graph = buildPromptGraph(prompts, { tags: true, variables: true, versions: true });
  assert.equal(graph.nodes.filter((node) => node.kind === "tag").length, 1);
  assert.equal(graph.nodes.filter((node) => node.kind === "variable").length, 1);
  assert.equal(graph.nodes.filter((node) => node.kind === "version").length, 3);
  assert.equal(graph.edges.length, 7);
  for (const edge of graph.edges) {
    const source = graph.nodes.find((node) => node.id === edge.source)!;
    const target = graph.nodes.find((node) => node.id === edge.target)!;
    assert.equal(source.kind, "prompt");
    if (target.kind === "version") assert.equal(source.promptId, target.promptId);
  }
  assert.ok(graph.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
});

test("disabling relationships preserves isolated prompts and empty libraries stay empty", () => {
  const options = { tags: false, variables: false, versions: false };
  const graph = buildPromptGraph(demoSamples, options);
  assert.equal(graph.nodes.length, demoSamples.length);
  assert.equal(graph.edges.length, 0);
  assert.deepEqual(buildPromptGraph([], options), { nodes: [], edges: [] });
});
