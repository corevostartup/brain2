import type { ANCCProcessResult } from "@/ancc/models/context";
import { reinforceVaultPathAffinity, type PlasticityAgentState } from "@/ancc/agents/plasticity-agent";
import { analyzeInteractionOutcome } from "@/ancc/agents/outcome-agent";
import { adjustMemoryGraphForOutcome } from "@/ancc/agents/memory-graph-agent";
import type { InteractionOutcome } from "@/ancc/models/metadata";
import type { MemoryLink } from "@/ancc/models/link";

export type FinalizeInteractionOptions = {
  userMessage: string;
  assistantMessage: string;
  /** Resultado de `processInteraction` antes do LLM. */
  preInteractionResult: ANCCProcessResult;
  plasticityState: PlasticityAgentState;
  vaultNoteTitles: string[];
};

export type FinalizeInteractionResult = {
  outcome: InteractionOutcome;
  outcomeConfidence: number;
  signals: string[];
  assistantTopics: string[];
  adjustedLinks: MemoryLink[];
  graphPruned: number;
  graphNodesAdded: number;
};

/**
 * Etapas 10–12 ANCC: análise de outcome → re-peso de ligações → grafo de memória atualizado.
 * Chamar após receber a resposta do modelo; o estado de plasticidade é mutado in-place (sessão).
 */
export function finalizeInteractionAfterResponse(opts: FinalizeInteractionOptions): FinalizeInteractionResult {
  const nowMs = Date.now();
  const analysis = analyzeInteractionOutcome({
    userMessage: opts.userMessage,
    assistantMessage: opts.assistantMessage,
    userTopics: opts.preInteractionResult.topics,
    vaultNoteTitles: opts.vaultNoteTitles,
  });

  const graph = adjustMemoryGraphForOutcome({
    plasticity: opts.plasticityState,
    baseLinks: opts.preInteractionResult.links,
    outcome: analysis.outcome,
    userTopics: opts.preInteractionResult.topics,
    assistantTopics: analysis.assistantTopics,
    nowMs,
  });

  reinforceVaultPathAffinity(
    opts.plasticityState,
    analysis.outcome,
    opts.preInteractionResult.assembled.vaultCorrelations.map((h) => h.path)
  );

  const confidence = analysis.confidence;

  return {
    outcome: analysis.outcome,
    outcomeConfidence: confidence,
    signals: analysis.signals,
    assistantTopics: analysis.assistantTopics,
    adjustedLinks: graph.links,
    graphPruned: graph.prunedCount,
    graphNodesAdded: graph.addedNodes,
  };
}

/**
 * Enriquece o resultado persistido no vault com outcome e ligações pós-re-peso.
 */
export function enrichAnccProcessResultWithOutcome(
  pre: ANCCProcessResult,
  finalized: FinalizeInteractionResult
): ANCCProcessResult {
  const updatedAt = new Date().toISOString();
  return {
    ...pre,
    links: finalized.adjustedLinks,
    memoryNote: {
      ...pre.memoryNote,
      links: finalized.adjustedLinks,
      updatedAt,
    },
    notePreview: {
      ...pre.notePreview,
      links: finalized.adjustedLinks,
    },
    interactionOutcome: finalized.outcome,
    outcomeConfidence: finalized.outcomeConfidence,
    outcomeSignals: finalized.signals,
    assistantTopicsAfterResponse: finalized.assistantTopics,
  };
}
