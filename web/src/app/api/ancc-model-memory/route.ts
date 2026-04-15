import { NextResponse } from "next/server";
import type { InteractionOutcome } from "@/ancc/models/metadata";
import type { StructuredMemoryItem, StructuredTemporalItem } from "@/lib/anccModelMemoryStructured";
import { normalizeStructuredTemporalArray } from "@/lib/anccModelMemoryStructured";

export const runtime = "nodejs";

type Body = {
  model?: string;
  apiKey?: string;
  userMessage?: string;
  assistantMessage?: string;
  outcome?: InteractionOutcome;
  assistantTopics?: string[];
  /** YYYY-MM-DD calendário local do cliente — «hoje» para resolver expressões relativas. */
  referenceLocalDate?: string;
  /** Epoch ms — início da conversa (metadados Brain2). */
  conversationStartedAt?: number;
};

type OpenAIChatCompletionJson = {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
};

function extractJsonObject(raw: string): unknown {
  const t = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(t);
  const inner = fence ? fence[1].trim() : t;
  return JSON.parse(inner) as unknown;
}

function normalizeResponseMemories(raw: unknown): StructuredMemoryItem[] {
  if (!raw || typeof raw !== "object") return [];
  const o = raw as { memories?: unknown };
  if (!Array.isArray(o.memories)) return [];
  const out: StructuredMemoryItem[] = [];
  for (const x of o.memories) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const summary = typeof r.summary === "string" ? r.summary.trim() : "";
    if (!summary) continue;
    const topics = Array.isArray(r.topics)
      ? r.topics.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      : undefined;
    let confidence: number | undefined;
    if (typeof r.confidence === "number" && Number.isFinite(r.confidence)) {
      confidence = Math.max(0, Math.min(1, r.confidence));
    }
    const store = typeof r.store === "boolean" ? r.store : true;
    out.push({ summary, topics, confidence, store });
  }
  return out;
}

function normalizeResponseTemporal(raw: unknown): StructuredTemporalItem[] {
  if (!raw || typeof raw !== "object") return [];
  const o = raw as { temporal?: unknown };
  return normalizeStructuredTemporalArray(o.temporal);
}

/**
 * Micro-chamada LLM: extrai reflexões e/ou lembretes temporais para ANCC quando o fence principal falha ou não existe.
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  const model = body.model?.trim();
  const apiKey = body.apiKey?.trim();
  if (!model || !apiKey) {
    return NextResponse.json({ error: "model e apiKey são obrigatórios." }, { status: 400 });
  }

  const userMessage = body.userMessage?.trim() ?? "";
  const assistantMessage = body.assistantMessage?.trim() ?? "";
  if (!assistantMessage) {
    return NextResponse.json(
      { memories: [] satisfies StructuredMemoryItem[], temporal: [] satisfies StructuredTemporalItem[] },
      { status: 200 },
    );
  }

  const refDate = body.referenceLocalDate?.trim() || "";
  const system = [
    "És um extrator para o sistema ANCC. Devolve APENAS um único objeto JSON válido (sem markdown à volta, sem texto antes ou depois).",
    'Formato: {"memories":[...],"temporal":[...]}',
    "memories (máx. 2): reflexões do assistente sobre o turno — não inventes factos sobre a vida do utilizador.",
    "temporal (máx. 2): pedidos de lembrete, datas citadas, ou eventos ligados a um dia. Campos: dueLocalDate (YYYY-MM-DD), summary (o que relembrar), store (bool), recurrence \"yearly\" para aniversários/datas anuais.",
    "Datas relativas: usa referenceLocalDate como «hoje» no calendário local e converte expressões como «amanhã», «daqui a duas semanas», «semana que vem», «em um mês» para dueLocalDate (aproximações aceitáveis).",
    "Se não houver nada temporal, usa temporal: []. Se não houver reflexões, usa memories: [].",
    "confidence em memories entre 0 e 1 quando aplicável.",
  ].join("\n");

  const userPayload = JSON.stringify(
    {
      userMessage,
      assistantMessage,
      outcome: body.outcome ?? "unknown",
      assistantTopics: body.assistantTopics ?? [],
      referenceLocalDate: refDate,
      conversationStartedAt:
        typeof body.conversationStartedAt === "number" && Number.isFinite(body.conversationStartedAt)
          ? body.conversationStartedAt
          : null,
    },
    null,
    0
  );

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPayload },
      ],
      temperature: 0.2,
      max_tokens: 500,
    }),
  });

  let payload: OpenAIChatCompletionJson | null = null;
  try {
    payload = (await response.json()) as OpenAIChatCompletionJson;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const err = payload?.error?.message?.trim();
    return NextResponse.json({ error: err || "Falha no micro-extractor." }, { status: response.status || 502 });
  }

  const text = payload?.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) {
    return NextResponse.json({ memories: [], temporal: [] }, { status: 200 });
  }

  try {
    const parsed = extractJsonObject(text);
    const memories = normalizeResponseMemories(parsed);
    const temporal = normalizeResponseTemporal(parsed);
    return NextResponse.json({ memories, temporal }, { status: 200 });
  } catch {
    return NextResponse.json({ memories: [], temporal: [] }, { status: 200 });
  }
}
