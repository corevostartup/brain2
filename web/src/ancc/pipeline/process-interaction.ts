import type { ANCCProcessResult } from "@/ancc/models/context";
import type { MemoryNote } from "@/ancc/models/memory";
import { createEmptyMemoryNote } from "@/ancc/models/memory";
import { interpretUserInput } from "@/ancc/agents/input-agent";
import { extractTopics } from "@/ancc/agents/topic-agent";
import { buildMemoryLinks, type StrengthAgentInput } from "@/ancc/agents/strength-agent";
import { assignMemoryClass } from "@/ancc/agents/memory-class-agent";
import { assembleContext } from "@/ancc/agents/context-agent";
import { buildHiddenSystemPromptBlock } from "@/ancc/agents/prompt-agent";
import {
  mergeWithPlasticity,
  createPlasticityState,
  type PlasticityAgentState,
} from "@/ancc/agents/plasticity-agent";
import { correlateVaultFiles, type VaultFileSnapshot, buildVaultIndex } from "@/ancc/pipeline/vault-correlation";
import { newInteractionId } from "@/ancc/models/metadata";

export type TopicRecurrenceTracker = {
  counts: Map<string, number>;
};

export function createRecurrenceTracker(): TopicRecurrenceTracker {
  return { counts: new Map() };
}

function bumpRecurrence(tracker: TopicRecurrenceTracker, topics: string[]): number {
  let maxR = 0;
  for (const t of topics) {
    const k = t.toLowerCase();
    const n = (tracker.counts.get(k) ?? 0) + 1;
    tracker.counts.set(k, n);
    maxR = Math.max(maxR, n);
  }
  return Math.min(1, maxR / 8);
}

export type ProcessInteractionOptions = {
  userMessage: string;
  /** Ficheiros `.md` atuais do vault — o ANCC procura correlações aqui a cada interação. */
  vaultFiles: VaultFileSnapshot[];
  plasticityState: PlasticityAgentState;
  recurrenceTracker: TopicRecurrenceTracker;
  /** Resumo curto opcional (ex.: última intenção do utilizador). */
  recentBullets?: string[];
};

export function processInteraction(opts: ProcessInteractionOptions): ANCCProcessResult {
  const nowMs = Date.now();
  const raw = interpretUserInput(opts.userMessage);
  const vaultTitles = opts.vaultFiles.map((f) => f.name.replace(/\.md$/i, ""));
  const topics = extractTopics({
    text: raw.normalizedText,
    vaultNoteTitles: vaultTitles,
  });

  const recurrenceScore = bumpRecurrence(opts.recurrenceTracker, topics);
  const vaultHits = correlateVaultFiles(topics, opts.vaultFiles);
  const index = buildVaultIndex(opts.vaultFiles);

  const bestFileRelevanceByTopic = new Map<string, number>();
  for (const h of vaultHits) {
    for (const t of h.matchedTopics) {
      const k = t.toLowerCase();
      const prev = bestFileRelevanceByTopic.get(k) ?? 0;
      if (h.relevance > prev) {
        bestFileRelevanceByTopic.set(k, h.relevance);
      }
    }
  }

  const scoreForTopic = (topic: string): StrengthAgentInput => {
    const tl = topic.toLowerCase();
    const topicMatch = bestFileRelevanceByTopic.get(tl) ?? 0;
    const recurrence = Math.min(1, (opts.recurrenceTracker.counts.get(tl) ?? 0) / 6);
    const recency = 0.85;
    let structuralImportance = 0.2;
    if (index.titlesLower.has(tl)) {
      structuralImportance += 0.45;
    }
    if (index.wikiTargetsLower.has(tl)) {
      structuralImportance += 0.25;
    }
    structuralImportance = Math.min(1, structuralImportance);

    return {
      topic,
      topicMatch: topicMatch > 0 ? topicMatch : Math.min(0.25, recurrence * 0.2),
      recurrence,
      recency,
      structuralImportance,
    };
  };

  let links = buildMemoryLinks(topics, scoreForTopic);
  links = mergeWithPlasticity(links, opts.plasticityState, nowMs);

  const maxStrength = links.reduce((m, l) => Math.max(m, l.strength), 0);
  const memoryClass = assignMemoryClass({
    topics,
    maxLinkStrength: maxStrength,
    recurrenceScore,
    userText: raw.normalizedText,
  });

  const assembled = assembleContext({
    topics,
    links,
    memoryClass,
    vaultCorrelations: vaultHits,
    recentBullets: opts.recentBullets ?? [],
  });

  const hiddenSystemBlock = buildHiddenSystemPromptBlock(assembled);

  const id = newInteractionId();
  const note: MemoryNote = {
    ...createEmptyMemoryNote({
      id,
      title: `Interaction ${id.slice(0, 8)}`,
      content: raw.normalizedText,
    }),
    topics,
    links,
    memoryClass,
    updatedAt: new Date(nowMs).toISOString(),
  };

  return {
    rawInterpretation: raw.normalizedText,
    topics,
    links,
    memoryClass,
    assembled,
    hiddenSystemBlock,
    memoryNote: note,
    notePreview: {
      title: note.title,
      topics: note.topics,
      links: note.links,
      memoryClass: note.memoryClass,
    },
  };
}

export function createDefaultANCCSession(): {
  plasticity: PlasticityAgentState;
  recurrence: TopicRecurrenceTracker;
} {
  return {
    plasticity: createPlasticityState(),
    recurrence: createRecurrenceTracker(),
  };
}
