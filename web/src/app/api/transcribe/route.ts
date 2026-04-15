import { NextResponse } from "next/server";
import { whisperUploadBasename } from "@/lib/whisperAudioFilename";

export const runtime = "nodejs";

/**
 * Proxy para OpenAI Whisper — mesma chave que o chat; não armazena áudio.
 * @see https://platform.openai.com/docs/api-reference/audio/createTranscription
 */
export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Formulário inválido." }, { status: 400 });
  }

  const apiKey = String(formData.get("apiKey") ?? "").trim();
  const mimeTypeHint = String(formData.get("mimeTypeHint") ?? "").trim();
  const file = formData.get("file");

  if (!apiKey) {
    return NextResponse.json({ error: "API key não informada." }, { status: 400 });
  }

  if (!file || !(file instanceof Blob) || file.size < 1) {
    return NextResponse.json({ error: "Ficheiro de áudio em falta ou vazio." }, { status: 400 });
  }

  const upstreamName = whisperUploadBasename(file, mimeTypeHint);

  const upstream = new FormData();
  upstream.append("file", file, upstreamName);
  upstream.append("model", "whisper-1");
  upstream.append("language", "pt");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: upstream,
  });

  let payload: { text?: string; error?: { message?: string } } | null = null;
  try {
    payload = (await response.json()) as { text?: string; error?: { message?: string } };
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const msg = payload?.error?.message?.trim() || "Falha na transcrição.";
    return NextResponse.json({ error: msg }, { status: response.status >= 400 && response.status < 600 ? response.status : 502 });
  }

  const text = typeof payload?.text === "string" ? payload.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "Transcrição vazia." }, { status: 502 });
  }

  return NextResponse.json({ text }, { status: 200 });
}
