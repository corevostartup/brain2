/**
 * Web Speech API (Chrome / Edge / Safari WebKit) — reconhecimento contínuo com resultados intermédios.
 * Não envia áudio a servidores externos (motor do SO / browser).
 */

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: { results: Array<{ 0: { transcript: string }; isFinal: boolean; length: number }>; length: number }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function getSpeechRecognitionConstructor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") {
    return null;
  }
  const w = window as Window &
    typeof globalThis & {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type LiveTranscriptionHandlers = {
  onText: (text: string) => void;
  onError?: (message: string) => void;
};

/** Erros que o WebKit dispara durante reinícios ou pausas — não são falhas para o utilizador. */
function isBenignSpeechRecognitionError(code: string): boolean {
  return (
    code === "aborted" ||
    code === "no-speech" ||
    /** macOS / iOS WebKit: sessão de áudio ou reconhecimento interrompido; o onend reinicia. */
    code === "interrupted" ||
    /** Transiente (rede / serviço Apple / Google). */
    code === "network"
  );
}

function shouldUseWebKitStableMode(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  if (document.documentElement.hasAttribute("data-brain2-native")) {
    return true;
  }
  if (typeof navigator === "undefined") {
    return false;
  }
  const ua = navigator.userAgent;
  return /AppleWebKit/.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua);
}

export type StartLiveTranscriptionOptions = {
  lang?: string;
  /**
   * Forçar modo WebKit (continuous=false + reinício com atraso).
   * Por defeito activa em app nativa (data-brain2-native) ou Safari clássico.
   */
  webkitStableMode?: boolean;
};

/**
 * Inicia reconhecimento contínuo (ou por frases em WebKit). Devolve função `stop`.
 */
export function startLiveTranscription(
  handlers: LiveTranscriptionHandlers,
  options?: StartLiveTranscriptionOptions,
): () => void {
  const Ctor = getSpeechRecognitionConstructor();
  if (!Ctor) {
    handlers.onError?.("unsupported");
    return () => {};
  }

  const rec = new Ctor();
  rec.lang = options?.lang ?? "pt-BR";
  const webkitStable = options?.webkitStableMode ?? shouldUseWebKitStableMode();
  /** Safari/WKWebView: `continuous=true` tende a erros "interrupted"; frase-a-frase + reinício é mais estável. */
  rec.continuous = !webkitStable;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let stopped = false;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;

  const restartDelayMs = webkitStable ? 240 : 60;

  const restart = () => {
    if (stopped) {
      return;
    }
    try {
      rec.start();
    } catch {
      /* já iniciado — WebKit: tentar de novo após um tick */
      if (webkitStable && !stopped) {
        restartTimer = setTimeout(() => {
          restartTimer = null;
          if (!stopped) {
            try {
              rec.start();
            } catch {
              /* ignore */
            }
          }
        }, 90);
      }
    }
  };

  rec.onresult = (event: { results: Array<{ 0: { transcript: string }; isFinal: boolean; length: number }> }) => {
    let text = "";
    for (let i = 0; i < event.results.length; i += 1) {
      const r = event.results[i];
      if (!r?.[0]) {
        continue;
      }
      text += r[0].transcript;
      if (r.isFinal) {
        text += " ";
      }
    }
    handlers.onText(text.trim());
  };

  rec.onerror = (event: { error: string }) => {
    if (isBenignSpeechRecognitionError(event.error)) {
      return;
    }
    if (event.error === "not-allowed") {
      handlers.onError?.("denied");
      return;
    }
    handlers.onError?.(event.error);
  };

  rec.onend = () => {
    if (stopped) {
      return;
    }
    if (restartTimer !== null) {
      clearTimeout(restartTimer);
    }
    restartTimer = setTimeout(() => {
      restartTimer = null;
      restart();
    }, restartDelayMs);
  };

  try {
    rec.start();
  } catch {
    handlers.onError?.("start-failed");
  }

  return () => {
    stopped = true;
    if (restartTimer !== null) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    try {
      rec.abort();
    } catch {
      /* ignore */
    }
  };
}
