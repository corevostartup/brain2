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

/**
 * Inicia reconhecimento contínuo. Devolve função `stop`.
 */
export function startLiveTranscription(
  handlers: LiveTranscriptionHandlers,
  options?: { lang?: string },
): () => void {
  const Ctor = getSpeechRecognitionConstructor();
  if (!Ctor) {
    handlers.onError?.("unsupported");
    return () => {};
  }

  const rec = new Ctor();
  rec.lang = options?.lang ?? "pt-BR";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let stopped = false;

  const restart = () => {
    if (stopped) {
      return;
    }
    try {
      rec.start();
    } catch {
      /* já iniciado */
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
    if (event.error === "aborted" || event.error === "no-speech") {
      return;
    }
    if (event.error === "not-allowed") {
      handlers.onError?.("denied");
      return;
    }
    handlers.onError?.(event.error);
  };

  rec.onend = () => {
    if (!stopped) {
      restart();
    }
  };

  try {
    rec.start();
  } catch {
    handlers.onError?.("start-failed");
  }

  return () => {
    stopped = true;
    try {
      rec.stop();
    } catch {
      /* ignore */
    }
    try {
      rec.abort();
    } catch {
      /* ignore */
    }
  };
}
