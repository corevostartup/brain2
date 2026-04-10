import { buildBrain2SystemRulesBlock } from "@/lib/brain2/rules/system-rules";

/**
 * Identidade fixa do assistente (uma linha). O resto das regras de sistema vive em
 * `brain2/rules/system-rules.ts`.
 */
export const BRAIN2_CORE_IDENTITY =
  "You are Brain2, an intelligent second brain assistant.";

/**
 * Monta o system prompt base: identidade + módulo de regras do sistema + (noutro sítio) ANCC.
 */
export function buildBrain2BaseSystemPrompt(): string {
  return [BRAIN2_CORE_IDENTITY, "", buildBrain2SystemRulesBlock()].join("\n");
}

/**
 * @deprecated Prefer `buildBrain2BaseSystemPrompt()` para deixar explícita a composição.
 * Mantido para imports existentes.
 */
export const BRAIN2_BASE_SYSTEM_PROMPT = buildBrain2BaseSystemPrompt();

export {
  BRAIN2_SYSTEM_RULES,
  BRAIN2_SYSTEM_RULES_MARKERS,
  buildBrain2SystemRulesBlock,
  type Brain2SystemRule,
} from "@/lib/brain2/rules/system-rules";
