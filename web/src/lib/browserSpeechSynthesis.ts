/**
 * Web Speech API — síntese de voz no browser (sem servidor).
 * Em alguns browsers as vozes carregam de forma assíncrona (`voiceschanged`).
 *
 * Qualidade: depende das vozes instaladas no SO (ex.: macOS “Enhanced”, Edge neural).
 * Não existe um “modelo” gratuito embutido no browser — priorizamos heuristicamente vozes
 * mais naturais quando o sistema as expõe; `rate`/`pitch` por defeito mais “humanos”.
 *
 * Dica (macOS): Ajustes > Acessibilidade > Conteúdo falado > Voz do sistema — descarregar
 * vozes pt-BR de alta qualidade; no Windows, “Definições de hora e idioma” > Vozes.
 */

/** Ritmo um pouco abaixo de 1.0 reduz sensação “robótica” na maioria dos motores. */
const DEFAULT_TTS_RATE = 0.91;
/** Tom ligeiramente mais grave que 1.0 costuma soar mais natural em pt-BR. */
const DEFAULT_TTS_PITCH = 0.97;

export function isBrowserSpeechSynthesisAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined";
}

function isBrazilianPortuguese(v: SpeechSynthesisVoice): boolean {
  return /^pt[-_]BR/i.test(v.lang.trim());
}

/**
 * Pontua vozes do sistema: preferir nomes que indicam neural / premium / melhor qualidade.
 * (Heurística — varia entre macOS, Windows, Chrome, WebKit.)
 */
function voiceNaturalnessScore(v: SpeechSynthesisVoice): number {
  const n = `${v.name} ${v.voiceURI}`.toLowerCase();
  let s = 0;
  if (/neural|enhanced|premium|natural|wavenet|personal|expressive|eloquence|hd\b|high\s*quality/i.test(n)) {
    s += 45;
  }
  if (/google|microsoft|apple|siri|onedrive|onecore|edge|offline.*pt|download/i.test(n)) {
    s += 12;
  }
  /** Nomes comuns de vozes pt-BR de melhor tier em macOS / iOS. */
  if (/\b(luciana|fernanda|ticiana|heloisa|maria|joana|vit[oó]ria|amanda|camila)\b/i.test(n)) {
    s += 18;
  }
  if (v.localService) {
    s += 8;
  }
  if (/compact|legacy|basic|robot|synthetic|crisp\s*mini|zarvox|bad\s*news/i.test(n)) {
    s -= 35;
  }
  return s;
}

function sortVoicesByNaturalness(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return [...voices].sort((a, b) => {
    const d = voiceNaturalnessScore(b) - voiceNaturalnessScore(a);
    if (d !== 0) {
      return d;
    }
    return a.name.localeCompare(b.name);
  });
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

/** Preferência: português do Brasil (pt-BR) + voz feminina, com melhor qualidade disponível. */
function pickBrazilianPortugueseFemaleVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return null;
  }
  const voices = window.speechSynthesis.getVoices();
  const br = voices.filter(isBrazilianPortuguese);

  const femaleBr = sortVoicesByNaturalness(br.filter(isLikelyFemaleVoice));
  if (femaleBr.length > 0) {
    return femaleBr[0]!;
  }

  const notMaleBr = sortVoicesByNaturalness(br.filter((v) => !isLikelyMaleVoice(v)));
  if (notMaleBr.length > 0) {
    return notMaleBr[0]!;
  }

  const brSorted = sortVoicesByNaturalness(br);
  if (brSorted.length > 0) {
    return brSorted[0]!;
  }

  const ptAny = voices.filter((v) => /^pt/i.test(v.lang.trim()));
  const ptFemale = sortVoicesByNaturalness(ptAny.filter(isLikelyFemaleVoice));
  if (ptFemale.length > 0) {
    return ptFemale[0]!;
  }
  const ptSorted = sortVoicesByNaturalness(ptAny);
  return ptSorted[0] ?? null;
}

export type SpeakBrowserTextOptions = {
  /** Por defeito `pt-BR` (voz feminina quando o sistema expõe várias). */
  lang?: string;
  rate?: number;
  pitch?: number;
  onStart?: () => void;
  /** Palavra ou frase — `charIndex`/`charLength` relativos ao texto passado a `speakBrowserText`. */
  onBoundary?: (ev: SpeechSynthesisEvent) => void;
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
    u.rate = options?.rate ?? DEFAULT_TTS_RATE;
    u.pitch = options?.pitch ?? DEFAULT_TTS_PITCH;
    u.volume = 1;
    const voice = pickBrazilianPortugueseFemaleVoice();
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.onstart = () => {
      options?.onStart?.();
    };
    u.onboundary = (ev: SpeechSynthesisEvent) => {
      options?.onBoundary?.(ev);
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
