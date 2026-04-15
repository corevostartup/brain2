/**
 * Converte expressões temporais relativas em português (aproximado) para dueLocalDate,
 * quando o LLM ainda não preencheu o campo — complementa o fence / micro ANCC.
 */

import type { StructuredTemporalItem } from "@/lib/anccModelMemoryStructured";
import { formatLocalDateKey } from "@/lib/anccTemporalMemory";

function addDaysLocal(anchor: Date, days: number): Date {
  const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

const PT_WORD_NUM: Record<string, number> = {
  um: 1,
  uma: 1,
  umas: 1,
  dois: 2,
  duas: 2,
  três: 3,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
};

function matchIntWord(s: string): number | undefined {
  const k = s.toLowerCase().trim();
  return PT_WORD_NUM[k];
}

/**
 * Devolve deslocamento em dias relativamente a `anchor` (meia-noite local implícita no Date).
 */
export function matchPortugueseRelativeOffsetDays(textLower: string, original: string): number | null {
  const t = textLower.replace(/\s+/g, " ").trim();

  if (/\bdepois\s+de\s+amanh[ãa]\b/.test(t)) return 2;
  if (/\bamanh[ãa]\b/.test(t)) return 1;
  if (/\bhoje\b/.test(t)) return 0;

  let m = t.match(/\bdaqui\s+a\s+(\d+)\s+dias?\b/);
  if (m) return Math.min(366, Math.max(0, parseInt(m[1], 10)));

  m = t.match(/\bdaqui\s+a\s+(\d+)\s+semanas?\b/);
  if (m) return Math.min(366, Math.max(0, parseInt(m[1], 10) * 7));

  m = t.match(/\bem\s+(\d+)\s+semanas?\b/);
  if (m) return Math.min(366, Math.max(0, parseInt(m[1], 10) * 7));

  m = t.match(/\bdaqui\s+a\s+(?:a\s+)?(uma?|duas?|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez)\s+semanas?\b/);
  if (m) {
    const n = matchIntWord(m[1] ?? "") ?? 1;
    return Math.min(366, n * 7);
  }

  m = t.match(/\bdaqui\s+a\s+(\d+)\s+mes(?:es)?\b/);
  if (m) return Math.min(400, Math.max(0, parseInt(m[1], 10) * 30));

  m = t.match(
    /\bdaqui\s+a\s+(?:a\s+)?(um|uma|dois|duas|tr[eê]s|tres|quatro|cinco)\s+mes(?:es)?\b/,
  );
  if (m) {
    const n = matchIntWord(m[1] ?? "") ?? 1;
    return Math.min(400, n * 30);
  }

  if (/\b(semana\s+que\s+vem|pr[oó]xim[oa]s?\s+semana|na\s+pr[oó]xima\s+semana)\b/.test(t)) {
    return 7;
  }

  if (/\b(pr[oó]ximo|pr[oó]xima)\s+m[eê]s\b/.test(t)) return 30;

  /* Frases longas tipo "daqui a duas semanas" sem "semanas" explícito — raro */
  m = original.match(/\bdaqui\s+a\s+(\d+)\s*\/\s*(\d+)/i);
  if (m) return null;

  return null;
}

function suggestsReminderOrScheduleIntent(textLower: string): boolean {
  return /\b(lembr|lembra|lembrar|relembr|agenda|marcar|marca|avis|avisa|combin|combiná|combinamos|n[aã]o\s+esquec|esquecer|anota|nota\s+para|lembrete|data\s+limite|até\s+lá|nesse\s+dia|quando\s+chegar)\b/i.test(
    textLower,
  );
}

function summarizeForTemporal(original: string): string {
  const oneLine = original.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 160) return oneLine;
  return `${oneLine.slice(0, 157)}…`;
}

/**
 * Extrai no máximo um lembrete temporal a partir de linguagem relativa PT, quando não há ISO no texto.
 */
export function tryExtractRelativeTemporalFromUserMessage(
  userMessage: string,
  anchor: Date,
): StructuredTemporalItem[] {
  const trimmed = userMessage.trim();
  if (trimmed.length < 6) return [];

  const lower = trimmed.toLowerCase();
  const offset = matchPortugueseRelativeOffsetDays(lower, trimmed);
  if (offset == null) return [];

  if (!suggestsReminderOrScheduleIntent(lower)) {
    /* Ainda assim: frases explícitas "daqui a X semanas" costumam ser compromissos */
    const explicitRelative =
      /\b(daqui\s+a|em\s+\d+\s+semanas|semana\s+que\s+vem|pr[oó]xim[oa]s?\s+semana)\b/.test(lower);
    if (!explicitRelative) return [];
  }

  const dueLocalDate = formatLocalDateKey(addDaysLocal(anchor, offset));
  return [
    {
      dueLocalDate,
      summary: summarizeForTemporal(trimmed),
      store: true,
      recurrence: "none",
    },
  ];
}
