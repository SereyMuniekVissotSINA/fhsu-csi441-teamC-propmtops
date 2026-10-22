import { variableNames, type DemoPrompt } from "./demo-prompts";

export type GraphNode = { id: string; label: string; kind: "prompt" | "tag" | "variable" | "version"; promptId?: string; versionId?: string; x: number; y: number };
export type GraphEdge = { source: string; target: string };

export function buildPromptGraph(prompts: DemoPrompt[], options: { tags: boolean; variables: boolean; versions: boolean }) {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const known = new Set<string>();
  function add(id: string, label: string, kind: GraphNode["kind"], promptId?: string, versionId?: string) {
    if (known.has(id)) return;
    known.add(id);
    nodes.push({ id, label, kind, promptId, versionId, x: 0, y: 0 });
  }
  for (const prompt of prompts) {
    const latest = prompt.versions.at(-1)!;
    const id = JSON.stringify(["prompt", prompt.id]);
    add(id, latest.title, "prompt", prompt.id);
    const connect = (kind: "tag" | "variable", label: string) => {
      const target = JSON.stringify([kind, label]);
      add(target, label, kind);
      edges.push({ source: id, target });
    };
    if (options.tags) for (const tag of new Set(latest.tags.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))) connect("tag", tag);
    if (options.variables) for (const variable of variableNames(latest.body)) connect("variable", variable);
    if (options.versions) prompt.versions.forEach((version, index) => {
      const target = JSON.stringify(["version", prompt.id, version.id]);
      add(target, `v${index + 1} · ${version.title}`, "version", prompt.id, version.id);
      edges.push({ source: id, target });
    });
  }
  // Deterministic force layout: stable on rerenders and no animation loop needed.
  nodes.forEach((node, index) => {
    const angle = index * 2.399963;
    const radius = 40 * Math.sqrt(index + 1);
    node.x = 450 + Math.cos(angle) * radius;
    node.y = 300 + Math.sin(angle) * radius;
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (let step = 0; step < 100; step++) {
    const forces = new Map(nodes.map((node) => [node.id, { x: (450 - node.x) * 0.007, y: (300 - node.y) * 0.007 }]));
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const dx = a.x - b.x, dy = a.y - b.y;
      const distance = Math.max(10, Math.hypot(dx, dy));
      const strength = 1600 / (distance * distance);
      const fa = forces.get(a.id)!, fb = forces.get(b.id)!;
      fa.x += dx / distance * strength; fa.y += dy / distance * strength;
      fb.x -= dx / distance * strength; fb.y -= dy / distance * strength;
    }
    for (const edge of edges) {
      const a = byId.get(edge.source)!, b = byId.get(edge.target)!;
      const dx = b.x - a.x, dy = b.y - a.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const strength = (distance - 105) * 0.025;
      const fa = forces.get(a.id)!, fb = forces.get(b.id)!;
      fa.x += dx / distance * strength; fa.y += dy / distance * strength;
      fb.x -= dx / distance * strength; fb.y -= dy / distance * strength;
    }
    nodes.forEach((node) => { const force = forces.get(node.id)!; node.x += Math.max(-12, Math.min(12, force.x)); node.y += Math.max(-12, Math.min(12, force.y)); });
  }
  return { nodes, edges };
}
