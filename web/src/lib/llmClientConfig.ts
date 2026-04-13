/**
 * Leitura da configuração LLM (localStorage + bridge nativa) — partilhada entre InputBar e conversa avançada.
 */

const LLM_STORAGE_KEY = "brain2-llm-config";
const LLM_MODEL_STORAGE_KEY = "brain2-llm-model";
const LLM_API_KEY_STORAGE_KEY = "brain2-llm-api-key";

type NativeBridge = {
  llmConfig?: {
    model?: string;
    apiKey?: string;
  };
};

export type LlmClientConfig = {
  model: string;
  apiKey: string;
};

export function loadLlmConfig(): LlmClientConfig | null {
  if (typeof window === "undefined") {
    return null;
  }

  const modelStored = localStorage.getItem(LLM_MODEL_STORAGE_KEY)?.trim() ?? "";
  const apiKeyStored = localStorage.getItem(LLM_API_KEY_STORAGE_KEY)?.trim() ?? "";
  if (apiKeyStored) {
    return {
      model: modelStored || "gpt-5.4-mini",
      apiKey: apiKeyStored,
    };
  }

  try {
    const raw = localStorage.getItem(LLM_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LlmClientConfig>;
      const parsedApiKey = parsed.apiKey?.trim() ?? "";
      const parsedModel = parsed.model?.trim() ?? "";
      if (parsedApiKey) {
        return {
          model: parsedModel || "gpt-5.4-mini",
          apiKey: parsedApiKey,
        };
      }
    }
  } catch {
    /* ignore */
  }

  const nativeConfig = (window as Window & { Brain2Native?: NativeBridge }).Brain2Native?.llmConfig;
  const nativeApiKey = nativeConfig?.apiKey?.trim() ?? "";
  const nativeModel = nativeConfig?.model?.trim() ?? "";
  if (nativeApiKey) {
    return {
      model: nativeModel || "gpt-5.4-mini",
      apiKey: nativeApiKey,
    };
  }

  return null;
}
