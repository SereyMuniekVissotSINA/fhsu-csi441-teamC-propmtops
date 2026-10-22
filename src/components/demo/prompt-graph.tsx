"use client";

import { useMemo, useRef, useState } from "react";
import type { DemoPrompt } from "@/lib/demo-prompts";
import { buildPromptGraph } from "@/lib/prompt-graph";

const colors = { prompt: "#34d399", tag: "#c4b5fd", variable: "#7dd3fc", version: "#fbbf24" };
const button = "rounded-md border border-zinc-700 px-3 py-2 text-xs hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-emerald-400";

export function PromptGraph({ prompts, onSelect }: { prompts: DemoPrompt[]; onSelect: (promptId: string, versionId?: string) => void }) {
  const [options, setOptions] = useState({ tags: true, variables: true, versions: false });
  const [focus, setFocus] = useState("");
  const [local, setLocal] = useState(false);
  const [labels, setLabels] = useState(true);
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const drag = useRef<{ id?: string; x: number; y: number; moved: boolean } | null>(null);
  // Keep the SVG usable with large libraries; search narrows the visible prompts.
  const graph = useMemo(() => buildPromptGraph(prompts.slice(0, 60), options), [prompts, options]);
  const active = graph.nodes.find((node) => node.id === focus);
  const neighbors = new Set([focus]);
  graph.edges.forEach((edge) => { if (edge.source === focus) neighbors.add(edge.target); if (edge.target === focus) neighbors.add(edge.source); });
  const visible = graph.nodes.filter((node) => !local || !active || neighbors.has(node.id));
  const byId = new Map(visible.map((node) => [node.id, { ...node, ...(positions[node.id] ?? {}) }]));
  const edges = graph.edges.filter((edge) => byId.has(edge.source) && byId.has(edge.target));
  const points = visible;
  const minX = Math.min(0, ...points.map((node) => node.x - 90));
  const minY = Math.min(0, ...points.map((node) => node.y - 45));
  const width = Math.max(900, ...points.map((node) => node.x + 90)) - minX;
  const height = Math.max(600, ...points.map((node) => node.y + 45)) - minY;
  function select(id: string) {
    setFocus(id);
    const node = byId.get(id);
    if (node?.promptId) onSelect(node.promptId, node.versionId);
  }
  return <section aria-label="Prompt relationship graph" className="mb-6 overflow-hidden rounded-xl border border-zinc-800 bg-[#0c0d10]">
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 p-4">
      <div><h2 className="font-medium">Graph view</h2><p className="mt-1 text-xs text-zinc-400">Connections from the latest prompt’s tags and variables. Versions belong to their prompt.</p></div>
      <div className="flex flex-wrap gap-4 text-xs text-zinc-300">
        {(Object.keys(options) as (keyof typeof options)[]).map((key) => <label key={key} className="flex items-center gap-2 capitalize"><input type="checkbox" checked={options[key]} onChange={(event) => setOptions({ ...options, [key]: event.target.checked })} />{key}</label>)}
        <label className="flex items-center gap-2"><input type="checkbox" checked={labels} onChange={(event) => setLabels(event.target.checked)} />Labels</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={local} onChange={(event) => { setLocal(event.target.checked); setCamera({ x: 0, y: 0, scale: 1 }); }} />Local focus</label>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
      <button className={button} aria-label="Zoom out" onClick={() => setCamera({ ...camera, scale: Math.max(0.4, camera.scale / 1.25) })}>−</button>
      <button className={button} aria-label="Zoom in" onClick={() => setCamera({ ...camera, scale: Math.min(4, camera.scale * 1.25) })}>+</button>
      <button className={button} onClick={() => { setCamera({ x: 0, y: 0, scale: 1 }); setPositions({}); }}>Reset view</button>
      <button className={button} onClick={() => { setFocus(""); setLocal(false); }}>Clear focus</button>
      <span className="ml-auto text-xs text-zinc-500">{visible.length} nodes · {edges.length} connections</span>
    </div>
    {prompts.length > 60 && <p role="status" className="px-4 pt-3 text-xs text-amber-300">Showing the first 60 matching prompts. Narrow your search to explore the rest.</p>}
    {!prompts.length ? <p className="p-12 text-center text-zinc-400">No matching prompts to visualize.</p> : <svg aria-label="Interactive graph. Tab to a node and press Enter to select it." role="group" viewBox={`${minX} ${minY} ${width} ${height}`} className="h-[520px] w-full touch-none select-none" onPointerDown={(event) => {
      const target = (event.target as Element).closest("[data-node]");
      drag.current = { id: target?.getAttribute("data-node") ?? undefined, x: event.clientX, y: event.clientY, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={(event) => {
      const current = drag.current;
      if (!current) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const factor = Math.max(width / rect.width, height / rect.height);
      const dx = (event.clientX - current.x) * factor, dy = (event.clientY - current.y) * factor;
      if (Math.abs(dx) + Math.abs(dy) > 2) current.moved = true;
      if (current.id) {
        const node = byId.get(current.id);
        if (node) setPositions((previous) => ({ ...previous, [node.id]: { x: node.x + dx / camera.scale, y: node.y + dy / camera.scale } }));
      } else setCamera((previous) => ({ ...previous, x: previous.x + dx, y: previous.y + dy }));
      current.x = event.clientX; current.y = event.clientY;
    }} onPointerUp={() => { if (drag.current?.id && !drag.current.moved) select(drag.current.id); drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <g transform={`translate(${camera.x + (minX + width / 2) * (1 - camera.scale)} ${camera.y + (minY + height / 2) * (1 - camera.scale)}) scale(${camera.scale})`}>
        {edges.map((edge) => { const a = byId.get(edge.source)!, b = byId.get(edge.target)!; const highlighted = edge.source === focus || edge.target === focus;
          return <line key={`${edge.source}:${edge.target}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={highlighted ? "#6ee7b7" : "#42434d"} strokeWidth={highlighted ? 1.8 : 1} opacity={active && !highlighted ? 0.2 : 0.7} />;
        })}
        {[...byId.values()].map((node) => <g key={node.id} data-node={node.id} role="button" tabIndex={0} aria-label={`${node.kind}: ${node.label}`} aria-pressed={node.id === focus} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(node.id); } }} className="cursor-pointer outline-none focus-visible:[&>circle]:stroke-white" opacity={active && !neighbors.has(node.id) ? 0.25 : 1}>
          <title>{node.kind}: {node.label}</title>
          <circle cx={node.x} cy={node.y} r={node.kind === "prompt" ? 12 : 7} fill={colors[node.kind]} stroke={node.id === focus ? "white" : "transparent"} strokeWidth={3} />
          {labels && <text x={node.x} y={node.y + 27} textAnchor="middle" fill={node.id === focus ? "#fff" : "#a1a1aa"} fontSize={11}>{node.label.length > 30 ? `${node.label.slice(0, 28)}…` : node.label}</text>}
        </g>)}
      </g>
    </svg>}
    <div className="flex flex-wrap gap-4 border-t border-zinc-800 p-4 text-xs text-zinc-400">
      {Object.entries(colors).map(([kind, color]) => <span key={kind} className="flex items-center gap-2 capitalize"><span className="h-2 w-2 rounded-full" style={{ background: color }} />{kind}</span>)}
      <span className="ml-auto">Drag nodes to arrange · Drag background to pan · Select a prompt to inspect below</span>
    </div>
    {active && <p role="status" className="border-t border-zinc-800 px-4 py-3 text-sm text-emerald-300">{active.label} · {neighbors.size - 1} connections{active.kind === "tag" || active.kind === "variable" ? " · Select a connected prompt to read it." : " · Details shown below."}</p>}
  </section>;
}
