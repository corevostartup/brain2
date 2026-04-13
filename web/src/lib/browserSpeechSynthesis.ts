/**
 * Web Speech API — síntese de voz no browser (sem servidor).
 * Em alguns browsers as vozes carregam de forma assíncrona (`voiceschanged`).
 */

export function isBrowserSpeechSynthesisAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined";
}

function isBrazilianPortuguese(v: SpeechSynthesisVoice): boolean {
  return /^pt[-_]BR/i.test(v.lang.trim());
}

/** Heurística — a API não expõe género; nomes variam por SO (macOS, Windows, Chrome). */
function isLikelyFemaleVoice(v: SpeechSynthesisVoice): boolean {
  const hay = `${v.name} ${v.voiceURI}`.toLowerCase();
  if (
    /\b(male|mascul|homem|man|♂|masc|antonio|carlos|daniel|felipe|joão|joao|lucas|marcos|paulo|ricardo|tiago|eduardo)\b/i.test(
      hay,
    )
  ) {
    return false;
  }
  return (
    /female|femin|fêmea|mulher|woman|♀|maria|luciana|fernanda|amanda|francisca|joana|vitória|vitoria|raquel|camila|letícia|leticia|beatriz|ana\b|gabriela|brasil.*female|pt-br.*female|brazil.*female/i.test(
      hay,
    )
  );
}

function isLikelyMaleVoice(v: SpeechSynthesisVoice): boolean {
  const hay = `${v.name} ${v.voiceURI}`.toLowerCase();
  return /\b(male|mascul|homem|man|♂|masc)\b|antonio|carlos|daniel|felipe|joão|joao|lucas|marcos|paulo|ricardo|tiago|eduardo/i.test(
    hay,
  );
}

/** Preferência: português do Brasil (pt-BR) + voz feminina. */
function pickBrazilianPortugueseFemaleVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return null;
  }
  const voices = window.speechSynthesis.getVoices();
  const br = voices.filter(isBrazilianPortuguese);

  const femaleBr = br.filter(isLikelyFemaleVoice);
  if (femaleBr.length > 0) {
    return femaleBr[0]!;
  }

  const notMaleBr = br.filter((v) => !isLikelyMaleVoice(v));
  if (notMaleBr.length > 0) {
    return notMaleBr[0]!;
  }

  if (br.length > 0) {
    return br[0]!;
  }

  const ptAny = voices.filter((v) => /^pt/i.test(v.lang.trim()));
  const ptFemale = ptAny.filter(isLikelyFemaleVoice);
  return ptFemale[0] ?? ptAny[0] ?? null;
}

export type SpeakBrowserTextOptions = {
  /** Por defeito `pt-BR` (voz feminina quando o sistema expõe várias). */
  lang?: string;
  rate?: number;
  pitch?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: () => void;
};

/**
 * Cancela fila anterior e fala o texto. Usar `cancelBrowserSpeech` no unmount.
 */
export function speakBrowserText(text: string, options?: SpeakBrowserTextOptions): void {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    queueMicrotask(() => options?.onEnd?.());
    return;
  }

  const trimmed = text.trim();
  if (!trimmed) {
    queueMicrotask(() => options?.onEnd?.());
    return;
  }

  const synth = window.speechSynthesis;
  synth.cancel();

  const run = () => {
    const u = new SpeechSynthesisUtterance(trimmed);
    u.lang = options?.lang ?? "pt-BR";
    u.rate = options?.rate ?? 1;
    u.pitch = options?.pitch ?? 1;
    const voice = pickBrazilianPortugueseFemaleVoice();
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.onstart = () => {
      options?.onStart?.();
    };
    u.onend = () => {
      options?.onEnd?.();
    };
    u.onerror = () => {
      options?.onError?.();
      options?.onEnd?.();
    };
    synth.speak(u);
  };

  if (synth.getVoices().length > 0) {
    run();
    return;
  }

  let done = false;
  const runOnce = () => {
    if (done) {
      return;
    }
    done = true;
    synth.removeEventListener("voiceschanged", onVoices);
    run();
  };

  const onVoices = () => {
    runOnce();
  };
  synth.addEventListener("voiceschanged", onVoices);
  /** Alguns engines já têm vozes; `voiceschanged` pode não disparar. */
  window.setTimeout(runOnce, 750);
}

export function cancelBrowserSpeech(): void {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}
