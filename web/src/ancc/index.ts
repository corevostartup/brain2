/** ANCC — Artificial Neuroplastic Cognitive Correlation (módulo Brain2). */

export type { MemoryNote, MemoryClass } from "@/ancc/models/memory";
export { createEmptyMemoryNote } from "@/ancc/models/memory";
export type { MemoryLink, MemoryLinkType } from "@/ancc/models/link";
export {
  stripWikiBrackets,
  formatWikiLink,
  parseWikiLinksFromText,
  linkKey,
} from "@/ancc/models/link";
export type {
  AssembledContext,
  ANCCProcessResult,
  VaultCorrelationHit,
} from "@/ancc/models/context";
export type { InteractionOutcome, InteractionMetadata } from "@/ancc/models/metadata";
export { newInteractionId } from "@/ancc/models/metadata";

export { interpretUserInput } from "@/ancc/agents/input-agent";
export { extractTopics } from "@/ancc/agents/topic-agent";
export { topicsToWikiLinks } from "@/ancc/agents/linker-agent";
export { scoreLinkStrength, buildMemoryLinks } from "@/ancc/agents/strength-agent";
export { assignMemoryClass } from "@/ancc/agents/memory-class-agent";
export { assembleContext } from "@/ancc/agents/context-agent";
export { buildHiddenSystemPromptBlock } from "@/ancc/agents/prompt-agent";
export {
  mergeWithPlasticity,
  createPlasticityState,
  type PlasticityAgentState,
} from "@/ancc/agents/plasticity-agent";

export { LINK_STRENGTH_WEIGHTS, MIN_CORRELATION_TO_LINK } from "@/ancc/rules/link-strength.rules";
export { PLASTICITY } from "@/ancc/rules/plasticity.rules";
export { ANCC_CONTEXT_MARKERS } from "@/ancc/rules/prompt-injection.rules";

export {
  processInteraction,
  createDefaultANCCSession,
  createRecurrenceTracker,
  type ProcessInteractionOptions,
  type TopicRecurrenceTracker,
} from "@/ancc/pipeline/process-interaction";
export type { VaultFileSnapshot } from "@/ancc/pipeline/vault-correlation";
export {
  correlateVaultFiles,
  buildVaultIndex,
  noteTitleFromFileName,
  scoreTopicFileCorrelation,
} from "@/ancc/pipeline/vault-correlation";
export { adjustNoteLinks } from "@/ancc/pipeline/update-links";
export { buildSystemContextBlock } from "@/ancc/pipeline/build-system-context";
