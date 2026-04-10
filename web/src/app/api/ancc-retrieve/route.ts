import { NextResponse } from "next/server";
import { hybridRetrieveVaultCorrelationHits } from "@/ancc/pipeline/hybrid-vault-retrieval";
import type { VaultFileSnapshot } from "@/ancc/pipeline/vault-correlation";

export const runtime = "nodejs";
export const maxDuration = 60;

type RequestBody = {
  apiKey?: string;
  userMessage?: string;
  sessionSummary?: string;
  recentBullets?: string[];
  vaultFiles?: VaultFileSnapshot[];
};

async function embedOpenAITextsSmall(apiKey: string, texts: string[]): Promise<number[][]> {
  const model = "text-embedding-3-small";
  const BATCH = 36;
  const all: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, input: batch }),
    });
    const json = (await res.json()) as {
      data?: Array<{ index: number; embedding: number[] }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(json.error?.message?.trim() || "Falha nos embeddings.");
    }
    const row = [...(json.data ?? [])].sort((a, b) => a.index - b.index);
    all.push(...row.map((r) => r.embedding));
  }
  return all;
}

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  const apiKey = body.apiKey?.trim();
  const userMessage = body.userMessage?.trim();
  const vaultFiles = Array.isArray(body.vaultFiles) ? body.vaultFiles : [];

  if (!userMessage) {
    return NextResponse.json({ error: "Mensagem em falta." }, { status: 400 });
  }
  if (!apiKey) {
    return NextResponse.json({ error: "API key em falta." }, { status: 400 });
  }
  if (vaultFiles.length === 0) {
    return NextResponse.json({ hits: [], mode: "lexical" as const }, { status: 200 });
  }

  try {
    const result = await hybridRetrieveVaultCorrelationHits({
      userMessage,
      sessionSummary: body.sessionSummary,
      recentBullets: body.recentBullets,
      vaultFiles,
      embedTexts: (texts) => embedOpenAITextsSmall(apiKey, texts),
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "retrieve_failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
