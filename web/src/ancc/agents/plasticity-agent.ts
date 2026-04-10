import type { MemoryLink } from "@/ancc/models/link";
import { applyDecay, applyReinforcement, PLASTICITY } from "@/ancc/rules/plasticity.rules";

export type LinkActivationState = {
  targetLower: string;
  lastSeenAt: number;
  strength: number;
  idleInteractions: number;
};

export type PlasticityAgentState = {
  activations: Map<string, LinkActivationState>;
};

export function createPlasticityState(): PlasticityAgentState {
  return { activations: new Map() };
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
