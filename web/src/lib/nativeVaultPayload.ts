import type { VaultGraph } from "@/lib/vault";

/**
 * Normaliza o grafo vindo do Swift (WKWebView) ou de JSON generico.
 * Aceita `links` em vez de `edges` e garante ids em string.
 */
export function coerceNativeVaultGraph(raw: unknown): VaultGraph | null | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null) {
    return null;
  }
  if (typeof raw !== "object") {
    return null;
  }

  const g = raw as Record<string, unknown>;
  const nodesRaw = g.nodes;
  const edgesRaw = g.edges ?? g.links;

  if (!Array.isArray(nodesRaw) || !Array.isArray(edgesRaw)) {
    return null;
  }

  const nodes: VaultGraph["nodes"] = [];
  for (const item of nodesRaw) {
    if (!item || typeof item !== "object") continue;
    const n = item as Record<string, unknown>;
    const id = typeof n.id === "string" ? n.id : String(n.id ?? "").trim();
    const label = typeof n.label === "string" ? n.label : String(n.label ?? id).trim();
    if (id) {
      nodes.push({ id, label: label || id });
    }
  }

  const edges: VaultGraph["edges"] = [];
  for (const item of edgesRaw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const source = typeof e.source === "string" ? e.source : String(e.source ?? "").trim();
    const target = typeof e.target === "string" ? e.target : String(e.target ?? "").trim();
    if (source && target) {
      edges.push({ source, target });
    }
  }

  return { nodes, edges };
}

export function fingerprintNativeVaultState(payload: {
  path?: string;
  graph?: VaultGraph | null;
  conversations?: Array<{ modifiedAt?: number }>;
}): string {
  const path = payload.path?.trim() ?? "";
  if (!path) return "";
  const g = payload.graph;
  const n = g?.nodes?.length ?? 0;
  const e = g?.edges?.length ?? 0;
  const conv = payload.conversations ?? [];
  const c = conv.length;
  const maxMod = conv.reduce((m, x) => Math.max(m, x.modifiedAt ?? 0), 0);
  return `${path}|${c}|${n}|${e}|${maxMod}`;
}
