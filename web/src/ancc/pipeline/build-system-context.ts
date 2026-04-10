import type { AssembledContext } from "@/ancc/models/context";
import { buildHiddenSystemPromptBlock } from "@/ancc/agents/prompt-agent";

export function buildSystemContextBlock(assembled: AssembledContext): string {
  return buildHiddenSystemPromptBlock(assembled);
}
