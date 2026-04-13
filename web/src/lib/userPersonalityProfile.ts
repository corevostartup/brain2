/**
 * Perfil de personalidade / comportamento definido pelo utilizador (0–100 por traço).
 * Persistido em localStorage; injetado no system prompt e no bloco ANCC.
 *
 * Atualização: o utilizador pode enviar percentagens explícitas **ou** descrever o tom em linguagem
 * natural (ex.: «muito humorada», «pouca ironia», «sarcasmo, humor e ironia»); o cliente infere
 * valores 0–100 (incluindo menção explícita de palavras‑chave sem número) e grava no mesmo
 * armazenamento — antes de cada envio (`saveUserPersonalityProfile` em `page.tsx`). Em Configurações,
 * o utilizador pode acrescentar texto livre (`customPersonality`) para qualquer característica.
 */

export const USER_PERSONALITY_STORAGE_KEY = "brain2-user-personality-profile";

export type PersonalityTraitId = "sarcasm" | "humor" | "creativity" | "boldness" | "stubbornness";

export type UserPersonalityProfile = {
  traits: Partial<Record<PersonalityTraitId, number>>;
  /**
   * Texto livre: estilo, características além dos 5 traços, metas de tom — persistido e injetado no system.
   */
  customPersonality?: string;
};

/** Limite de caracteres do campo livre (Configurações). */
export const MAX_CUSTOM_PERSONALITY_CHARS = 2500;

export function normalizeCustomPersonality(raw: string | undefined | null): string {
  if (raw == null || typeof raw !== "string") {
    return "";
  }
  const t = raw.replace(/\r\n/g, "\n").trim();
  if (t.length === 0) {
    return "";
  }
  return t.slice(0, MAX_CUSTOM_PERSONALITY_CHARS);
}

export const TRAIT_ORDER: PersonalityTraitId[] = [
  "sarcasm",
  "humor",
  "creativity",
  "boldness",
  "stubbornness",
];

/** Rótulos estáveis para o modelo (inglês) + sinónimos na conversa (PT/EN). */
export const PERSONALITY_TRAIT_META: Record<
  PersonalityTraitId,
  { labelEn: string; labelPt: string }
> = {
  sarcasm: { labelEn: "Sarcasm", labelPt: "Sarcasmo" },
  humor: { labelEn: "Humor", labelPt: "Humor" },
  creativity: { labelEn: "Creativity", labelPt: "Criatividade" },
  boldness: { labelEn: "Boldness / audacity", labelPt: "Ousadia" },
  stubbornness: { labelEn: "Stubbornness", labelPt: "Teimosia" },
};

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function emptyProfile(): UserPersonalityProfile {
  return { traits: {} };
}

export function loadUserPersonalityProfile(): UserPersonalityProfile {
  if (typeof window === "undefined") return emptyProfile();
  try {
    const raw = window.localStorage.getItem(USER_PERSONALITY_STORAGE_KEY);
    if (!raw) return emptyProfile();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return emptyProfile();
    }
    const p = parsed as { traits?: unknown; customPersonality?: unknown };
    const traits: Partial<Record<PersonalityTraitId, number>> = {};
    const t = p.traits;
    if (t && typeof t === "object") {
      for (const id of TRAIT_ORDER) {
        const v = (t as Record<string, unknown>)[id];
        if (typeof v === "number" && Number.isFinite(v)) {
          traits[id] = clampPercent(v);
        }
      }
    }
    const customNorm =
      typeof p.customPersonality === "string" ? normalizeCustomPersonality(p.customPersonality) : "";
    const out: UserPersonalityProfile = { traits };
    if (customNorm) {
      out.customPersonality = customNorm;
    }
    return out;
  } catch {
    return emptyProfile();
  }
}

export function saveUserPersonalityProfile(profile: UserPersonalityProfile): void {
  if (typeof window === "undefined") return;
  try {
    const cleaned: UserPersonalityProfile = { traits: {} };
    for (const id of TRAIT_ORDER) {
      const v = profile.traits[id];
      if (typeof v === "number") {
        cleaned.traits[id] = clampPercent(v);
      }
    }
    const customNorm = normalizeCustomPersonality(profile.customPersonality);
    if (customNorm) {
      cleaned.customPersonality = customNorm;
    }
    if (Object.keys(cleaned.traits).length === 0 && !cleaned.customPersonality) {
      window.localStorage.removeItem(USER_PERSONALITY_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(USER_PERSONALITY_STORAGE_KEY, JSON.stringify(cleaned));
  } catch {
    /* quota */
  }
}

export function mergeTraitPatchIntoProfile(
  previous: UserPersonalityProfile,
  patch: Partial<Record<PersonalityTraitId, number>>,
): UserPersonalityProfile {
  const traits: Partial<Record<PersonalityTraitId, number>> = { ...previous.traits };
  for (const id of TRAIT_ORDER) {
    const v = patch[id];
    if (typeof v === "number" && Number.isFinite(v)) {
      traits[id] = clampPercent(v);
    }
  }
  return { ...previous, traits };
}

function profilesEqual(a: UserPersonalityProfile, b: UserPersonalityProfile): boolean {
  for (const id of TRAIT_ORDER) {
    const av = a.traits[id];
    const bv = b.traits[id];
    if (av !== bv) return false;
  }
  return normalizeCustomPersonality(a.customPersonality) === normalizeCustomPersonality(b.customPersonality);
}

type TraitWords = { id: PersonalityTraitId; regex: string };

const TRAIT_WORD_GROUPS: TraitWords[] = [
  {
    id: "sarcasm",
    regex:
      "sarcasmo|sarcasm|sarcástic[oa]|sarcastic|ironia|irônic[oa]|ironic|ironias|irônias",
  },
  { id: "humor", regex: "humor|humorad[oa]|humorístic[oa]|engraçad[oa]|funny|humorous" },
  { id: "creativity", regex: "criatividade|criativ[oa]|creative|creativity" },
  { id: "boldness", regex: "ousadia|ousad[oa]|bold(?:ness)?|audacity|audac|diret[oa]|franc[oa]" },
  { id: "stubbornness", regex: "teimosia|teimos[oa]|stubborn(?:ness)?|cabeçud[oa]|insistente" },
];

/**
 * Extrai atualizações de percentagens a partir da mensagem (várias por texto / linhas).
 */
export function parsePersonalityTraitUpdatesFromMessage(text: string): Partial<Record<PersonalityTraitId, number>> {
  const out: Partial<Record<PersonalityTraitId, number>> = {};
  const t = text.trim();
  if (t.length < 4) return out;

  const chunks = [t, ...t.split(/\n/).map((l) => l.trim()).filter((l) => l.length > 3)];

  const applyMatch = (id: PersonalityTraitId, num: number) => {
    out[id] = clampPercent(num);
  };

  for (const chunk of chunks) {
    for (const { id, regex } of TRAIT_WORD_GROUPS) {
      const pctFirst = new RegExp(`(\\d{1,3})\\s*%\\s*(?:de\\s*)?(?:${regex})`, "gi");
      let m: RegExpExecArray | null;
      while ((m = pctFirst.exec(chunk)) !== null) {
        const n = parseInt(m[1] ?? "", 10);
        if (Number.isFinite(n)) applyMatch(id, n);
      }

      const wordFirst = new RegExp(`(?:${regex})\\s*(?:a|em|de|para|no)?\\s*(\\d{1,3})\\s*%?`, "gi");
      while ((m = wordFirst.exec(chunk)) !== null) {
        const n = parseInt(m[1] ?? "", 10);
        if (Number.isFinite(n)) applyMatch(id, n);
      }

      const nivel = new RegExp(
        `nível\\s+(?:de\\s*)?(?:${regex})\\s*(?:é|será|de|:)?\\s*(\\d{1,3})\\s*%?`,
        "gi",
      );
      while ((m = nivel.exec(chunk)) !== null) {
        const n = parseInt(m[1] ?? "", 10);
        if (Number.isFinite(n)) applyMatch(id, n);
      }

      const quero = new RegExp(
        `(?:quero|prefiro)\\s+que\\s+(?:vc|você|tu)\\s+(?:sejas|seja|esteja)\\s+(?:uma?\\s+)?(\\d{1,3})\\s*%\\s*(?:de\\s*)?(?:${regex})`,
        "gi",
      );
      while ((m = quero.exec(chunk)) !== null) {
        const n = parseInt(m[1] ?? "", 10);
        if (Number.isFinite(n)) applyMatch(id, n);
      }
    }
  }

  applyQualitativePersonalityHints(t, out);
  applyExplicitTraitWordMentions(t, out);

  return out;
}

type QualRule = {
  id: PersonalityTraitId;
  /** Mais específico primeiro: a primeira regra que corresponder aplica-se se o traço ainda estiver vazio. */
  patterns: RegExp[];
  value: number;
};

const QUALITATIVE_RULES: QualRule[] = [
  /* Humor */
  {
    id: "humor",
    patterns: [
      /\b(?:sem|zero|nenhum|cancela(?:r)?)\s+(?:de\s+)?humor\b/i,
      /\b(?:nada|nenhuma)\s+graça\b/i,
    ],
    value: 0,
  },
  {
    id: "humor",
    patterns: [/\b(?:super|hiper|extremamente)\s+humorad[oa]\b/i, /\b(?:muito|demasiad[oa])\s+humorístic[oa]\b/i],
    value: 95,
  },
  {
    id: "humor",
    patterns: [
      /\b(?:muito|bem|bastante)\s+humorad[oa]\b/i,
      /\b(?:muito|bastante|bem|com|tem)\s+humor\b/i,
      /\balto\s+humor\b/i,
      /\b(?:mais|quero\s+mais)\s+humor\b/i,
      /\bhumor\s+(?:alto|elevado|negro|seco)\b/i,
    ],
    value: 85,
  },
  {
    id: "humor",
    patterns: [
      /\b(?:moderad[oa]|médio|medio|equilibrad[oa]|razoável)\s+(?:no\s+)?humor\b/i,
      /\bhumor\s+(?:moderado|médio|equilibrado)\b/i,
    ],
    value: 50,
  },
  {
    id: "humor",
    patterns: [
      /\b(?:pouco|baix[oa]|discret[oa])\s+humorad[oa]\b/i,
      /\b(?:pouco|baixo)\s+humor\b/i,
      /\bmenos\s+humor\b/i,
      /\bhumor\s+(?:baixo|fraco|discreto)\b/i,
    ],
    value: 25,
  },
  {
    id: "humor",
    patterns: [/\b(?:máximo|máx\.?|no\s+máximo|100\s*%)\s+(?:de\s+)?humor\b/i],
    value: 100,
  },
  /* Sarcasmo / ironia */
  {
    id: "sarcasm",
    patterns: [
      /\b(?:sem|zero|nenhum|cancela(?:r)?)\s+(?:de\s+)?(?:sarcasmo|sarcasm|ironia)\b/i,
      /\b(?:sem|zero)\s+ironia\b/i,
    ],
    value: 0,
  },
  {
    id: "sarcasm",
    patterns: [
      /\b(?:muito|bem|bastante|super)\s+(?:sarcástic[oa]|irônic[oa])\b/i,
      /\bironia\s+(?:pesada|forte|marcada)\b/i,
      /\b(?:muito|alto)\s+(?:nível\s+de\s+)?(?:sarcasmo|ironia)\b/i,
    ],
    value: 88,
  },
  {
    id: "sarcasm",
    patterns: [
      /\b(?:leve|suave)\s+(?:sarcasmo|ironia)\b/i,
      /\bironia\s+(?:leve|suave)\b/i,
      /\bsarcasmo\s+leve\b/i,
    ],
    value: 40,
  },
  {
    id: "sarcasm",
    patterns: [/\b(?:pouco|baix[oa])\s+(?:sarcasmo|sarcástic[oa]|ironia)\b/i, /\bmenos\s+(?:ironia|sarcasmo)\b/i],
    value: 22,
  },
  /* Criatividade */
  {
    id: "creativity",
    patterns: [/\b(?:sem|pouca)\s+criatividade\b/i, /\b(?:pouco|baix[oa])\s+criativ[oa]\b/i],
    value: 20,
  },
  {
    id: "creativity",
    patterns: [/\b(?:muito|bem|bastante)\s+criativ[oa]\b/i, /\balta\s+criatividade\b/i, /\b(?:mais|quero\s+mais)\s+criatividade\b/i],
    value: 85,
  },
  {
    id: "creativity",
    patterns: [/\bcriatividade\s+(?:moderada|média)\b/i],
    value: 50,
  },
  /* Ousadia */
  {
    id: "boldness",
    patterns: [/\b(?:máximo|máx\.?|no\s+máximo)\s+(?:de\s+)?(?:ousadia|ousad[oa])\b/i],
    value: 100,
  },
  {
    id: "boldness",
    patterns: [
      /\b(?:muito|bem|bastante)\s+ousad[oa]\b/i,
      /\bfala\s+(?:bem\s+)?diret[oa]\b/i,
      /\b(?:sem\s+filtro|sincer[oa]\s+brutal)\b/i,
    ],
    value: 85,
  },
  {
    id: "boldness",
    patterns: [/\b(?:pouca|baixa)\s+ousadia\b/i, /\b(?:cautelos[oa]|reservad[oa])\s+(?:na\s+)?(?:fala|opinião)\b/i],
    value: 28,
  },
  /* Teimosia */
  {
    id: "stubbornness",
    patterns: [/\b(?:muito|bem)\s+teimos[oa]\b/i, /\balta\s+teimosia\b/i],
    value: 85,
  },
  {
    id: "stubbornness",
    patterns: [
      /\b(?:pouco|baix[oa])\s+teimos[oa]\b/i,
      /\b(?:flexível|abert[oa])\s+quando\s+(?:preciso|necessário)\b/i,
    ],
    value: 22,
  },
  /* Inglês (atalhos) */
  {
    id: "humor",
    patterns: [/\bvery\s+humorous\b/i, /\bhigh\s+humor\b/i],
    value: 85,
  },
  {
    id: "humor",
    patterns: [/\blittle\s+humor\b/i, /\blow\s+humor\b/i, /\bno\s+humor\b/i],
    value: 25,
  },
  {
    id: "sarcasm",
    patterns: [/\bvery\s+sarcastic\b/i, /\bheavy\s+irony\b/i],
    value: 88,
  },
  {
    id: "sarcasm",
    patterns: [/\blight\s+sarcasm\b/i, /\bsubtle\s+irony\b/i],
    value: 40,
  },
];

function applyQualitativePersonalityHints(
  text: string,
  out: Partial<Record<PersonalityTraitId, number>>,
): void {
  const setIfUnset = (id: PersonalityTraitId, val: number) => {
    if (out[id] === undefined) {
      out[id] = clampPercent(val);
    }
  };

  for (const rule of QUALITATIVE_RULES) {
    if (out[rule.id] !== undefined) {
      continue;
    }
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        setIfUnset(rule.id, rule.value);
        break;
      }
    }
  }
}

/** Nível quando o utilizador nomeia o traço sem percentagem (ex.: «sarcasmo, humor e ironia»). */
const DEFAULT_EXPLICIT_MENTION_LEVEL = 78;

function isLikelyNegatedTraitMention(fullText: string, matchIndex: number): boolean {
  const before = fullText.slice(0, matchIndex);
  const tail = before.slice(-56);
  return /\b(sem|n[aã]o|zero|nenhum|nenhuma)\s*$/i.test(tail.trimEnd());
}

/**
 * Preenche traços ainda não definidos quando o texto menciona explicitamente palavras-chave
 * (lista, pedido simples, etc.). «Ironia» mapeia para sarcasm (mesmo grupo léxico).
 */
function applyExplicitTraitWordMentions(
  text: string,
  out: Partial<Record<PersonalityTraitId, number>>,
): void {
  for (const { id, regex } of TRAIT_WORD_GROUPS) {
    if (out[id] !== undefined) {
      continue;
    }
    const wordPattern = new RegExp(`\\b(?:${regex})\\b`, "gi");
    let match: RegExpExecArray | null;
    while ((match = wordPattern.exec(text)) !== null) {
      if (isLikelyNegatedTraitMention(text, match.index)) {
        continue;
      }
      out[id] = clampPercent(DEFAULT_EXPLICIT_MENTION_LEVEL);
      break;
    }
  }
}

/**
 * Aplica patches à mensagem ao perfil anterior. Devolve o novo perfil e se houve mudança.
 */
export function applyPersonalityUpdatesFromUserMessage(
  message: string,
  previous: UserPersonalityProfile,
): { next: UserPersonalityProfile; changed: boolean } {
  const patch = parsePersonalityTraitUpdatesFromMessage(message);
  if (Object.keys(patch).length === 0) {
    return { next: previous, changed: false };
  }
  const next = mergeTraitPatchIntoProfile(previous, patch);
  return { next, changed: !profilesEqual(previous, next) };
}

/** Linha compacta para behavioral guidance ANCC. */
export function formatPersonalityForAnccGuidance(profile: UserPersonalityProfile | null): string | null {
  if (!profile) return null;
  const parts: string[] = [];
  for (const id of TRAIT_ORDER) {
    const v = profile.traits[id];
    if (typeof v === "number") {
      parts.push(`${id}=${v}`);
    }
  }
  const custom = normalizeCustomPersonality(profile.customPersonality);
  const segments: string[] = [];
  if (parts.length > 0) {
    segments.push(`User-defined personality levels (0–100, follow in tone): ${parts.join(", ")}`);
  }
  if (custom) {
    const snippet = custom.length > 220 ? `${custom.slice(0, 217).trimEnd()}…` : custom;
    segments.push(`User-defined style notes: ${snippet}`);
  }
  if (segments.length === 0) return null;
  return `${segments.join(". ")}.`;
}

/**
 * Bloco system para o LLM: contrato + níveis + como responder a perguntas sobre o perfil.
 */
export function buildUserPersonalitySystemAddition(profile: UserPersonalityProfile | null): string {
  const traits = profile?.traits ?? {};
  const custom = normalizeCustomPersonality(profile?.customPersonality);
  const hasTraitLevels = TRAIT_ORDER.some((id) => typeof traits[id] === "number");
  const hasCustom = custom.length > 0;

  const lines: string[] = [
    "[User personality profile — user-defined, persisted]",
    "Slider traits use a 0–100 scale (higher = stronger expression in your voice and stance). Free-text notes below may describe any style goals, including traits not covered by sliders.",
  ];

  if (!hasTraitLevels && !hasCustom) {
    lines.push(
      "Nothing is stored yet: no slider levels and no free-text notes. Stay balanced until the user adds text in Settings (personality field) and/or defines the five traits in chat (percentages or natural language).",
    );
    lines.push(
      "When they ask how your personality is configured, say nothing is saved yet and invite them to use Settings or chat.",
    );
    return lines.join("\n");
  }

  if (hasTraitLevels) {
    lines.push("Current slider-based trait levels (answer with these exact values when asked):");
    for (const id of TRAIT_ORDER) {
      const v = traits[id];
      if (typeof v === "number") {
        const m = PERSONALITY_TRAIT_META[id];
        lines.push(`- ${m.labelEn} (${m.labelPt}): ${v}%`);
      }
    }
    lines.push(
      "Follow these levels in how you speak: higher sarcasm → sharper ironic edge without cruelty; higher humor → lighter tone where appropriate; higher creativity → more varied angles; higher boldness → more direct opinions; higher stubbornness → firmer polite pushback.",
    );
    lines.push(
      "For slider traits: if they ask for a specific percentage, use the numbers above. If a slider trait was never set, say it is not customized (balanced default).",
    );
    lines.push(
      "They may update slider traits anytime in chat or in Settings; the app persists interpreted 0–100 values.",
    );
    lines.push(
      "If they describe mood without numbers for a slider trait, the saved numbers above are the app's interpretation—do not contradict them unless blending with free-text notes below.",
    );
  }

  if (hasCustom) {
    lines.push("");
    lines.push("[User-defined personality notes — free text, authoritative]");
    lines.push(
      "The user wrote this in Settings; treat it as equally important as slider levels. It may name characteristics that are not among the five sliders:",
    );
    lines.push(custom);
    lines.push(
      "Honor this text in tone and stance. If it appears to conflict with slider levels, blend both—the notes capture nuances sliders cannot express.",
    );
  }

  if (!hasTraitLevels && hasCustom) {
    lines.push(
      "Only free-text notes are stored (no slider traits yet). Follow the notes above. If they ask for slider percentages, say those traits are not set until they define them in chat.",
    );
  }

  return lines.join("\n");
}
