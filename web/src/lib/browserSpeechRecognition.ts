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

/** Erros que o WebKit / Chrome disparam durante reinícios, partilha de microfone ou pausas. */
function isBenignSpeechRecognitionError(code: string): boolean {
  const c = String(code).trim().toLowerCase();
  return (
    c === "aborted" ||
    c === "no-speech" ||
    /** macOS / iOS WebKit: sessão interrompida; o `onend` reinicia. */
    c === "interrupted" ||
    /** Transiente (rede / serviço Apple / Google). */
    c === "network" ||
    /** Comum no macOS quando o microfone está em uso (ex.: Web Audio + STT) ou a libertar. */
    c === "audio-capture" ||
    /** Alguns motores (p. ex. Safari) em silêncio ou rejeição de hipótese. */
    c === "no-match" ||
    /** WebKit: serviço de reconhecimento temporariamente indisponível. */
    c === "service-not-allowed" ||
    /** Gramática opcional inválida — ignorar. */
    c === "bad-grammar" ||
    /** Tentativa seguinte com outro `lang` no nível da app; aqui não é falha terminal. */
    c === "language-not-supported"
  );
}

function isLikelyEmbeddedWebKit(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const wk = (window as Window & { webkit?: { messageHandlers?: unknown } }).webkit;
  if (wk?.messageHandlers != null) {
    return true;
  }
  if (typeof navigator !== "undefined" && /WKWebView|Brain2|brain2/i.test(navigator.userAgent)) {
    return true;
  }
  return false;
}

export function shouldUseWebKitStableMode(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  if (document.documentElement.hasAttribute("data-brain2-native")) {
    return true;
  }
  if (isLikelyEmbeddedWebKit()) {
    return true;
  }
  if (typeof navigator === "undefined") {
    return false;
  }
  const ua = navigator.userAgent;
  return /AppleWebKit/.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua);
}

/** Atraso e modo frase-a-frase recomendados (WKWebView / Safari / app nativa). */
export function getDefaultLiveTranscriptionTiming(): {
  webkitStableMode: boolean;
  startDelayMs: number;
} {
  const stable = shouldUseWebKitStableMode();
  return {
    webkitStableMode: stable,
    startDelayMs: stable ? 520 : 0,
  };
}

export type StartLiveTranscriptionOptions = {
  lang?: string;
  /**
   * Forçar modo WebKit (continuous=false + reinício com atraso).
   * Por defeito activa em app nativa (data-brain2-native) ou Safari clássico.
   */
  webkitStableMode?: boolean;
  /**
   * Atraso antes do primeiro `rec.start()` — reduz corrida com getUserMedia / AudioContext no WKWebView (macOS).
   */
  startDelayMs?: number;
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
  let initialStartTimer: ReturnType<typeof setTimeout> | null = null;

  const restartDelayMs = webkitStable ? 280 : 60;
  const startDelayMs = Math.max(0, options?.startDelayMs ?? (webkitStable ? 520 : 0));

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
    const err = String(event.error ?? "");
    if (isBenignSpeechRecognitionError(err)) {
      return;
    }
    if (err === "not-allowed") {
      handlers.onError?.("denied");
      return;
    }
    handlers.onError?.(err);
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

  const doInitialStart = () => {
    if (stopped) {
      return;
    }
    try {
      rec.start();
    } catch {
      /** WebKit: `start` falha se a sessão anterior ainda não libertou — não mostrar erro; `onend` ou timer reinicia. */
      if (!stopped) {
        restartTimer = setTimeout(() => {
          restartTimer = null;
          restart();
        }, webkitStable ? 380 : 140);
      }
    }
  };

  if (startDelayMs > 0) {
    initialStartTimer = setTimeout(() => {
      initialStartTimer = null;
      doInitialStart();
    }, startDelayMs);
  } else {
    doInitialStart();
  }

  return () => {
    stopped = true;
    if (initialStartTimer !== null) {
      clearTimeout(initialStartTimer);
      initialStartTimer = null;
    }
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
