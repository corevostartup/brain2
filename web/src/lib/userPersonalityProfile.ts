/**
 * Perfil de personalidade / comportamento definido pelo utilizador (0–100 por traço).
 * Persistido em localStorage; injetado no system prompt e no bloco ANCC.
 */

export const USER_PERSONALITY_STORAGE_KEY = "brain2-user-personality-profile";

export type PersonalityTraitId = "sarcasm" | "humor" | "creativity" | "boldness" | "stubbornness";

export type UserPersonalityProfile = {
  traits: Partial<Record<PersonalityTraitId, number>>;
};

const TRAIT_ORDER: PersonalityTraitId[] = [
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
    if (!parsed || typeof parsed !== "object" || !("traits" in parsed)) {
      return emptyProfile();
    }
    const traits: Partial<Record<PersonalityTraitId, number>> = {};
    const t = (parsed as { traits?: unknown }).traits;
    if (t && typeof t === "object") {
      for (const id of TRAIT_ORDER) {
        const v = (t as Record<string, unknown>)[id];
        if (typeof v === "number" && Number.isFinite(v)) {
          traits[id] = clampPercent(v);
        }
      }
    }
    return { traits };
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
    if (Object.keys(cleaned.traits).length === 0) {
      window.localStorage.removeItem(USER_PERSONALITY_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(USER_PERSONALITY_STORAGE_KEY, JSON.stringify(cleaned));
  } catch {
    /* quota */
  }
}

function mergeTraits(
  base: Partial<Record<PersonalityTraitId, number>>,
  patch: Partial<Record<PersonalityTraitId, number>>,
): UserPersonalityProfile {
  const traits: Partial<Record<PersonalityTraitId, number>> = { ...base };
  for (const id of TRAIT_ORDER) {
    const v = patch[id];
    if (typeof v === "number" && Number.isFinite(v)) {
      traits[id] = clampPercent(v);
    }
  }
  return { traits };
}

function profilesEqual(a: UserPersonalityProfile, b: UserPersonalityProfile): boolean {
  for (const id of TRAIT_ORDER) {
    const av = a.traits[id];
    const bv = b.traits[id];
    if (av !== bv) return false;
  }
  return true;
}

type TraitWords = { id: PersonalityTraitId; regex: string };

const TRAIT_WORD_GROUPS: TraitWords[] = [
  { id: "sarcasm", regex: "sarcasmo|sarcasm|sarcástic[oa]|sarcastic" },
  { id: "humor", regex: "humor|engraçad[oa]|funny" },
  { id: "creativity", regex: "criatividade|criativ[oa]|creative|creativity" },
  { id: "boldness", regex: "ousadia|ousad[oa]|bold(?:ness)?|audacity|audac" },
  { id: "stubbornness", regex: "teimosia|teimos[oa]|stubborn(?:ness)?" },
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

  /** Atalhos qualitativos — só se esse traço ainda não foi definido por número nesta mensagem. */
  const setIfUnset = (id: PersonalityTraitId, val: number) => {
    if (out[id] === undefined) {
      out[id] = val;
    }
  };

  if (/\b(?:sem|zero|nenhum)\s+(?:nível\s+de\s+)?(?:sarcasmo|sarcasm)\b/i.test(t)) {
    setIfUnset("sarcasm", 0);
  }
  if (/\b(?:sem|zero|nenhum)\s+(?:nível\s+de\s+)?humor\b/i.test(t)) {
    setIfUnset("humor", 0);
  }
  if (/\b(?:máximo|máx\.?|no\s+máximo)\s+(?:de\s+)?humor\b/i.test(t)) {
    setIfUnset("humor", 100);
  }
  if (/\b(?:máximo|máx\.?|no\s+máximo)\s+(?:de\s+)?(?:ousadia|ousado)\b/i.test(t)) {
    setIfUnset("boldness", 100);
  }
  if (/\b(?:muito|bem)\s+(?:sarcástic[oa]|sarcastic)\b/i.test(t)) {
    setIfUnset("sarcasm", 85);
  }
  if (/\b(?:pouco|baix[oa])\s+(?:sarcasmo|sarcasm)\b/i.test(t)) {
    setIfUnset("sarcasm", 25);
  }

  return out;
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
  const next = mergeTraits(previous.traits, patch);
  return { next, changed: !profilesEqual(previous, next) };
}

/** Linha compacta para behavioral guidance ANCC. */
export function formatPersonalityForAnccGuidance(profile: UserPersonalityProfile | null): string | null {
  if (!profile?.traits) return null;
  const parts: string[] = [];
  for (const id of TRAIT_ORDER) {
    const v = profile.traits[id];
    if (typeof v === "number") {
      parts.push(`${id}=${v}`);
    }
  }
  if (parts.length === 0) return null;
  return `User-defined personality levels (0–100, follow in tone): ${parts.join(", ")}.`;
}

/**
 * Bloco system para o LLM: contrato + níveis + como responder a perguntas sobre o perfil.
 */
export function buildUserPersonalitySystemAddition(profile: UserPersonalityProfile | null): string {
  const traits = profile?.traits ?? {};
  const lines: string[] = [
    "[User personality profile — user-defined, persisted]",
    "Trait levels use a 0–100 scale (higher = stronger expression of that trait in your voice and stance).",
  ];

  const hasAny = TRAIT_ORDER.some((id) => typeof traits[id] === "number");
  if (!hasAny) {
    lines.push(
      "No custom levels are stored yet; stay balanced until the user sets percentages (e.g. sarcasm, humor, creativity, boldness, stubbornness).",
    );
    lines.push(
      "When they ask how your personality is configured, say no custom sliders are set yet and invite them to define levels in natural language.",
    );
    return lines.join("\n");
  }

  lines.push("Current levels (answer with these exact values when asked):");
  for (const id of TRAIT_ORDER) {
    const v = traits[id];
    if (typeof v === "number") {
      const m = PERSONALITY_TRAIT_META[id];
      lines.push(`- ${m.labelEn} (${m.labelPt}): ${v}%`);
    }
  }

  lines.push(
    "Follow these levels in how you speak: e.g. higher sarcasm → sharper ironic edge without becoming cruel; higher humor → lighter tone where appropriate; higher creativity → more varied angles; higher boldness → more direct opinions; higher stubbornness → firmer stance when pushing back politely.",
  );
  lines.push(
    "When the user asks how your personality is defined, what the levels are, or asks for a specific trait percentage (e.g. 'qual o meu nível de sarcasmo'), reply clearly listing each stored trait with its percentage in their language. If a trait was never set, say it is not customized (default balanced).",
  );
  lines.push(
    "They may update levels anytime in chat (e.g. 'humor 50%, sarcasm 70%'); treat the latest stored values as authoritative.",
  );

  return lines.join("\n");
}
