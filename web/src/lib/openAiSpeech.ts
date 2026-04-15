/**
 * Reprodução de voz via OpenAI TTS (`/api/tts`) — mesma API key que o chat.
 * Cancelar com `cancelOpenAiSpeech` antes de nova reprodução ou ao parar.
 */

import { cancelBrowserSpeech } from "@/lib/browserSpeechSynthesis";
import { loadLlmConfig } from "@/lib/llmClientConfig";

export const OPENAI_TTS_OUTPUT_STORAGE_KEY = "brain2-openai-tts-output";

/** Preferência de voz OpenAI; se nunca definida, activa por omissão quando existe API key. */
export function readOpenAiTtsOutputEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const v = localStorage.getItem(OPENAI_TTS_OUTPUT_STORAGE_KEY);
    if (v === null) {
      return Boolean(loadLlmConfig()?.apiKey?.trim());
    }
    return v === "1";
  } catch {
    return false;
  }
}

export function setOpenAiTtsOutputEnabled(value: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    localStorage.setItem(OPENAI_TTS_OUTPUT_STORAGE_KEY, value ? "1" : "0");
    window.dispatchEvent(new CustomEvent("brain2-openai-tts-changed"));
  } catch {
    /* ignore */
  }
}

let activeAbort: AbortController | null = null;
let activeAudio: HTMLAudioElement | null = null;
let activeObjectUrl: string | null = null;

export function cancelOpenAiSpeech(): void {
  activeAbort?.abort();
  activeAbort = null;
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.src = "";
    activeAudio = null;
  }
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
}

/** Cancela voz do browser e da OpenAI (uso antes de nova fala ou unmount). */
export function cancelAllAssistantSpeech(): void {
  cancelBrowserSpeech();
  cancelOpenAiSpeech();
}

export type PlayOpenAiSpeechOptions = {
  voice?: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
  model?: "tts-1" | "tts-1-hd";
  onStart?: () => void;
  /** Progresso 0…1 durante a reprodução (útil para sincronizar texto). */
  onTimeUpdate?: (ratio: number) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
};

/**
 * Obtém áudio do servidor e reproduz. Até 4096 caracteres (truncado no servidor).
 */
export async function playOpenAiSpeech(text: string, apiKey: string, options?: PlayOpenAiSpeechOptions): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed || !apiKey.trim()) {
    options?.onError?.("Texto ou API key em falta.");
    queueMicrotask(() => options?.onEnd?.());
    return;
  }

  cancelOpenAiSpeech();
  const abort = new AbortController();
  activeAbort = abort;

  try {
    const ttsUrl =
      typeof window !== "undefined" ? new URL("/api/tts", window.location.origin).toString() : "/api/tts";
    const response = await fetch(ttsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: abort.signal,
      body: JSON.stringify({
        apiKey: apiKey.trim(),
        text: trimmed,
        voice: options?.voice ?? "nova",
        model: options?.model ?? "tts-1",
        response_format: "mp3",
      }),
    });

    if (!response.ok) {
      const j = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error || "Falha ao gerar voz.");
    }

    const ct = response.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const j = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(typeof j.error === "string" ? j.error : "Resposta inválida do servidor TTS.");
    }

    const blob = await response.blob();
    if (blob.size < 64) {
      throw new Error("Áudio vazio ou inválido da API.");
    }

    const url = URL.createObjectURL(blob);
    activeObjectUrl = url;

    const audio = new Audio(url);
    /** Safari / WKWebView: sem isto o `play()` pode falhar ou não emitir som. */
    audio.setAttribute("playsInline", "true");
    audio.preload = "auto";
    try {
      audio.volume = 1;
    } catch {
      /* ignore */
    }
    activeAudio = audio;

    const cleanupPlayback = () => {
      if (activeObjectUrl === url) {
        URL.revokeObjectURL(url);
        activeObjectUrl = null;
      }
      if (activeAudio === audio) {
        activeAudio = null;
      }
      activeAbort = null;
    };

    audio.addEventListener("timeupdate", () => {
      const d = audio.duration;
      if (d > 0 && !Number.isNaN(d)) {
        options?.onTimeUpdate?.(Math.min(1, Math.max(0, audio.currentTime / d)));
      }
    });

    audio.addEventListener("ended", () => {
      cleanupPlayback();
      options?.onEnd?.();
    });

    audio.addEventListener("error", () => {
      cleanupPlayback();
      options?.onError?.("Erro ao reproduzir áudio.");
      options?.onEnd?.();
    });

    try {
      audio.load();
      /** Feedback imediato — o evento `playing` pode atrasar em WebKit. */
      options?.onStart?.();
      await audio.play();
    } catch {
      cleanupPlayback();
      options?.onError?.("Reprodução bloqueada ou falhou.");
    }
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return;
    }
    const msg = e instanceof Error ? e.message : "Erro na voz OpenAI.";
    options?.onError?.(msg);
    /** Sem `onEnd` aqui — fallback possível em `onError`. */
    activeAbort = null;
  }
}
