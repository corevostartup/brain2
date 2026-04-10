import type { MemoryLink } from "@/ancc/models/link";
import type { VaultCorrelationHit } from "@/ancc/models/context";
import type { InteractionOutcome } from "@/ancc/models/metadata";
import { applyDecay, applyReinforcement, PLASTICITY } from "@/ancc/rules/plasticity.rules";

export type LinkActivationState = {
  targetLower: string;
  lastSeenAt: number;
  strength: number;
  idleInteractions: number;
};

export type PlasticityAgentState = {
  activations: Map<string, LinkActivationState>;
  /**
   * Reforço neuroplastico por nota do vault (path normalizado): o ANCC «reaprende»
   * quais ficheiros costumam ser úteis nesta sessão.
   */
  vaultPathAffinity: Map<string, number>;
};

export function normalizeVaultPathKey(path: string): string {
  return path.replace(/\\/g, "/").trim().toLowerCase();
}

export function createPlasticityState(): PlasticityAgentState {
  return { activations: new Map(), vaultPathAffinity: new Map() };
}

/** Aplica afinidade de sessão às relevâncias devolvidas pelo retrieval. */
export function applyVaultPathAffinityToHits(
  hits: VaultCorrelationHit[],
  affinity: Map<string, number> | undefined
): VaultCorrelationHit[] {
  if (!affinity || affinity.size === 0) {
    return hits;
  }
  const adjusted = hits.map((h) => {
    const k = normalizeVaultPathKey(h.path);
    const a = affinity.get(k) ?? 0;
    const boost = 1 + 0.2 * a;
    return { ...h, relevance: Math.min(1, h.relevance * boost) };
  });
  return adjusted.sort((x, y) => y.relevance - x.relevance);
}

/** Atualiza afinidade por caminho consoante o outcome da troca. */
export function reinforceVaultPathAffinity(
  state: PlasticityAgentState,
  outcome: InteractionOutcome,
  vaultPaths: string[]
): void {
  const aff = state.vaultPathAffinity;
  const slice = vaultPaths.slice(0, 14);
  for (const raw of slice) {
    const k = normalizeVaultPathKey(raw);
    const cur = aff.get(k) ?? 0.14;
    if (outcome === "useful" || outcome === "deepened") {
      aff.set(k, Math.min(1, cur + 0.065));
    } else if (outcome === "ignored" || outcome === "redirected") {
      aff.set(k, Math.max(0, cur * 0.9));
    } else if (outcome === "corrected") {
      aff.set(k, Math.max(0, cur * 0.86));
    }
  }
}

function keyFor(target: string): string {
  return target.trim().toLowerCase();
}

/**
 * Reforça ligações mencionadas nesta interação; aplica decaimento às que ficaram em pausa.
 * Toda ligação deve «reconquistar» relevância ao ser reativada.
 */
export function mergeWithPlasticity(
  links: MemoryLink[],
  state: PlasticityAgentState,
  nowMs: number
): MemoryLink[] {
  const prev = state.activations;
  const currentKeys = new Set(links.map((l) => keyFor(l.target)));
  const staged = new Map<string, LinkActivationState>();

  for (const [k, v] of prev) {
    if (currentKeys.has(k)) {
      staged.set(k, v);
      continue;
    }
    const idle = v.idleInteractions + 1;
    const decayed = applyDecay(v.strength, 1);
    if (decayed >= PLASTICITY.pruneBelow) {
      staged.set(k, { ...v, strength: decayed, idleInteractions: idle });
    }
  }

  for (const link of links) {
    const k = keyFor(link.target);
    const old = staged.get(k) ?? prev.get(k);
    const base = old ? Math.max(old.strength, link.strength) : link.strength;
    const reinforced = applyReinforcement(base);
    staged.set(k, {
      targetLower: k,
      lastSeenAt: nowMs,
      strength: reinforced,
      idleInteractions: 0,
    });
  }

  state.activations = staged;

  return links.map((link) => {
    const k = keyFor(link.target);
    const act = staged.get(k);
    const s = act?.strength ?? link.strength;
    return { ...link, strength: s, updatedAt: new Date(nowMs).toISOString() };
  });
}
