/**
 * Lembretes por data (calendário local): extraídos do fence ANCC / micro-endpoint;
 * no dia indicado, na primeira resposta do turno, o contexto oculto pede ao modelo que relembre o utilizador.
 */

import type { StructuredTemporalItem } from "@/lib/anccModelMemoryStructured";

export type TemporalRecurrence = "none" | "yearly";

export type TemporalReminder = {
  id: string;
  /** Dia alvo no calendário local (YYYY-MM-DD). */
  dueLocalDate: string;
  /** O que relembrar (frase curta). */
  summary: string;
  createdAt: string;
  updatedAt: string;
  recurrence: TemporalRecurrence;
  /**
   * Data local (YYYY-MM-DD) em que o lembrete já foi integrado na resposta do assistente.
   * Para `yearly`, após lembrar avança `dueLocalDate` e limpa-se este campo.
   */
  remindedOnLocalDate?: string;
};

export type TemporalMemoryState = {
  version: 1;
  entries: TemporalReminder[];
};

const LS_KEY = "brain2-ancc-temporal-memory-v1";
const MAX_ENTRIES = 120;

export function formatLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isValidYmdLocal(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [ys, ms, ds] = s.split("-");
  const y = Number(ys);
  const mo = Number(ms);
  const d = Number(ds);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return false;
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

function addOneYearYmd(ymd: string): string {
  const [ys, ms, ds] = ymd.split("-");
  const y = Number(ys);
  const mo = Number(ms);
  const d = Number(ds);
  const dt = new Date(y + 1, mo - 1, d);
  return formatLocalDateKey(dt);
}

function newId(): string {
  return `tr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isValidEntry(e: unknown): e is TemporalReminder {
  if (!e || typeof e !== "object") return false;
  const x = e as TemporalReminder;
  return (
    typeof x.id === "string" &&
    typeof x.dueLocalDate === "string" &&
    typeof x.summary === "string" &&
    typeof x.createdAt === "string" &&
    typeof x.updatedAt === "string" &&
    (x.recurrence === "none" || x.recurrence === "yearly")
  );
}

export function loadTemporalMemoryState(): TemporalMemoryState {
  if (typeof window === "undefined") {
    return { version: 1, entries: [] };
  }
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return { version: 1, entries: [] };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { version: 1, entries: [] };
    const s = parsed as Partial<TemporalMemoryState>;
    if (s.version !== 1 || !Array.isArray(s.entries)) return { version: 1, entries: [] };
    return {
      version: 1,
      entries: s.entries.filter(isValidEntry).map((e) => ({
        ...e,
        recurrence: e.recurrence ?? "none",
      })),
    };
  } catch {
    return { version: 1, entries: [] };
  }
}

export function saveTemporalMemoryState(state: TemporalMemoryState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    /* quota */
  }
}

function summaryKey(summary: string): string {
  return summary
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 96);
}

/**
 * Lembretes cujo dia é hoje (local) e ainda não foram mencionados neste dia.
 */
export function getPendingRemindersForToday(
  state: TemporalMemoryState,
  todayLocalKey: string,
): TemporalReminder[] {
  return state.entries.filter(
    (e) => e.dueLocalDate === todayLocalKey && e.remindedOnLocalDate !== todayLocalKey,
  );
}

/**
 * Após o assistente responder com o lembrete integrado, marca como tratados (ou anual → próximo ano).
 */
export function markTemporalRemindersNotified(
  state: TemporalMemoryState,
  ids: string[],
  todayLocalKey: string,
): TemporalMemoryState {
  if (ids.length === 0) return state;
  const set = new Set(ids);
  const now = new Date().toISOString();
  const entries = state.entries.map((e) => {
    if (!set.has(e.id)) return e;
    if (e.recurrence === "yearly") {
      return {
        ...e,
        dueLocalDate: addOneYearYmd(e.dueLocalDate),
        remindedOnLocalDate: undefined,
        updatedAt: now,
      };
    }
    return {
      ...e,
      remindedOnLocalDate: todayLocalKey,
      updatedAt: now,
    };
  });
  return { version: 1, entries };
}

/**
 * Adiciona lembretes novos a partir do fence / micro; evita duplicar mesmo dia + mesmo resumo.
 */
export function mergeTemporalItemsIntoState(
  state: TemporalMemoryState,
  items: StructuredTemporalItem[],
): TemporalMemoryState {
  const now = new Date().toISOString();
  const storable = items.filter(
    (s) =>
      s.store !== false &&
      s.summary.trim().length > 0 &&
      isValidYmdLocal(s.dueLocalDate.trim()),
  );
  if (storable.length === 0) return state;

  const existingKeys = new Set(
    state.entries.map((e) => `${e.dueLocalDate}::${summaryKey(e.summary)}`),
  );

  const additions: TemporalReminder[] = [];
  for (const s of storable) {
    const due = s.dueLocalDate.trim();
    const sum = s.summary.trim().slice(0, 800);
    const key = `${due}::${summaryKey(sum)}`;
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    const recurrence: TemporalRecurrence = s.recurrence === "yearly" ? "yearly" : "none";
    additions.push({
      id: newId(),
      dueLocalDate: due,
      summary: sum,
      createdAt: now,
      updatedAt: now,
      recurrence,
    });
  }

  if (additions.length === 0) return state;
  const merged = [...state.entries, ...additions];
  const trimmed =
    merged.length > MAX_ENTRIES ? merged.slice(merged.length - MAX_ENTRIES) : merged;
  return { version: 1, entries: trimmed };
}

/**
 * Heurística leve: vale a pena chamar o micro-endpoint para extrair `temporal` quando o fence não trouxe nada.
 */
export function userMessageSuggestsTemporalExtract(msg: string): boolean {
  const t = msg.trim();
  if (t.length < 4) return false;
  return (
    /\b\d{4}-\d{2}-\d{2}\b/.test(t) ||
    /\b\d{1,2}\s*\/\s*\d{1,2}(\s*\/\s*\d{2,4})?\b/.test(t) ||
    /\bdaqui\s+a\b/.test(t) ||
    /\bem\s+\d+\s+semanas?\b/i.test(t) ||
    /\b(amanh[ãa]|hoje|depois\s+de\s+amanh[ãa]|semana\s+que\s+vem|m[êe]s\s+que\s+vem|pr[oó]xim[oa]s?|lembr|lembra|lembrar|agenda|anivers[aá]ri|data\b|dia\s+\d+)/i.test(
      t,
    )
  );
}
