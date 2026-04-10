import type { MemoryLink } from "@/ancc/models/link";
import { inferLinkType } from "@/ancc/agents/strength-agent";
import type { LinkActivationState, PlasticityAgentState } from "@/ancc/agents/plasticity-agent";
import { PLASTICITY } from "@/ancc/rules/plasticity.rules";
import { OUTCOME_WEIGHTING, applyStrengthFactor } from "@/ancc/rules/outcome.rules";
import { clamp01 } from "@/ancc/rules/link-strength.rules";
import type { InteractionOutcome } from "@/ancc/models/metadata";

function keyFor(target: string): string {
  return target.trim().toLowerCase();
}

function displayLabelForKey(keyLower: string, pools: string[]): string {
  const hit = pools.find((p) => p.trim().toLowerCase() === keyLower);
  return hit ?? keyLower;
}

/**
 * Aplica o outcome à plasticidade existente e materializa ligações atualizadas para a nota.
 * O grafo «vivo» = mapa de ativações com forças; nós novos surgem quando a resposta traz eixos novos.
 */
export function adjustMemoryGraphForOutcome(opts: {
  plasticity: PlasticityAgentState;
  baseLinks: MemoryLink[];
  outcome: InteractionOutcome;
  userTopics: string[];
  assistantTopics: string[];
  nowMs: number;
}): { links: MemoryLink[]; prunedCount: number; addedNodes: number } {
  const { plasticity, baseLinks, outcome, nowMs } = opts;
  const U = new Set(opts.userTopics.map((t) => keyFor(t)).filter(Boolean));
  const A = new Set(opts.assistantTopics.map((t) => keyFor(t)).filter(Boolean));
  const intersection = new Set<string>();
  for (const u of U) {
    if (A.has(u)) {
      intersection.add(u);
    }
  }
  const userOnly = [...U].filter((k) => !A.has(k));
  const assistantOnly = [...A].filter((k) => !U.has(k));

  const act = plasticity.activations;
  let prunedCount = 0;
  let addedNodes = 0;

  const touchKey = (k: string, factor: number) => {
    const cur = act.get(k);
    if (!cur) {
      return;
    }
    const next = applyStrengthFactor(cur.strength, factor);
    if (next < PLASTICITY.pruneBelow) {
      act.delete(k);
      prunedCount += 1;
    } else {
      act.set(k, {
        ...cur,
        strength: next,
        lastSeenAt: nowMs,
        idleInteractions: 0,
      });
    }
  };

  const seedAssistantAxis = (k: string) => {
    if (act.has(k)) {
      return;
    }
    const strength = clamp01(OUTCOME_WEIGHTING.newAssistantAxisSeed);
    act.set(k, {
      targetLower: k,
      lastSeenAt: nowMs,
      strength,
      idleInteractions: 0,
    });
    addedNodes += 1;
  };

  switch (outcome) {
    case "useful":
      for (const k of intersection) {
        touchKey(k, OUTCOME_WEIGHTING.usefulIntersectionBoost);
      }
      break;
    case "deepened":
      for (const k of intersection) {
        touchKey(k, OUTCOME_WEIGHTING.deepenedIntersectionBoost);
      }
      for (const k of assistantOnly.slice(0, 8)) {
        seedAssistantAxis(k);
      }
      break;
    case "corrected":
      for (const k of U) {
        touchKey(k, OUTCOME_WEIGHTING.correctedUserAxisFactor);
      }
      break;
    case "redirected":
      for (const k of userOnly) {
        touchKey(k, OUTCOME_WEIGHTING.redirectedUserOnlyFactor);
      }
      for (const k of intersection) {
        touchKey(k, OUTCOME_WEIGHTING.usefulIntersectionBoost);
      }
      for (const k of assistantOnly.slice(0, 12)) {
        seedAssistantAxis(k);
      }
      break;
    case "ignored":
      for (const k of act.keys()) {
        touchKey(k, OUTCOME_WEIGHTING.ignoredGlobalFactor);
      }
      break;
    case "unknown":
      for (const k of act.keys()) {
        touchKey(k, OUTCOME_WEIGHTING.unknownNeutralFactor);
      }
      break;
    default:
      break;
  }

  const labelPool = [...opts.userTopics, ...opts.assistantTopics];
  const targetKeys = new Set<string>();
  for (const l of baseLinks) {
    targetKeys.add(keyFor(l.target));
  }
  for (const k of act.keys()) {
    targetKeys.add(k);
  }

  const links: MemoryLink[] = [];
  for (const k of targetKeys) {
    const state: LinkActivationState | undefined = act.get(k);
    if (!state || state.strength < PLASTICITY.pruneBelow) {
      continue;
    }
    const display = displayLabelForKey(k, labelPool);
    const topicMatch =
      intersection.has(k) ? 0.55 : U.has(k) || A.has(k) ? 0.38 : 0.22;
    links.push({
      target: display,
      strength: state.strength,
      type: inferLinkType(state.strength, topicMatch),
      updatedAt: new Date(nowMs).toISOString(),
    });
  }

  links.sort((a, b) => b.strength - a.strength);

  return { links, prunedCount, addedNodes };
}
