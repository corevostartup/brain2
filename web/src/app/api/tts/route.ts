import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Vozes válidas na API OpenAI TTS (v1/audio/speech). */
const VOICES = new Set(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]);

type TtsBody = {
  apiKey?: string;
  text?: string;
  voice?: string;
  model?: string;
  response_format?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
};

/**
 * Proxy para OpenAI Text-to-Speech — mesma chave que o chat; o áudio não é armazenado.
 */
export async function POST(request: Request) {
  let body: TtsBody;
  try {
    body = (await request.json()) as TtsBody;
  } catch {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  const apiKey = body.apiKey?.trim();
  const text = body.text?.trim() ?? "";
  const voice = body.voice?.trim() ?? "nova";
  const model = body.model?.trim() === "tts-1-hd" ? "tts-1-hd" : "tts-1";
  const response_format = body.response_format ?? "mp3";

  if (!apiKey) {
    return NextResponse.json({ error: "API key não informada." }, { status: 400 });
  }

  if (!text) {
    return NextResponse.json({ error: "Texto em falta." }, { status: 400 });
  }

  const input = text.length > 4096 ? `${text.slice(0, 4093)}...` : text;
  const safeVoice = VOICES.has(voice) ? voice : "nova";

  const upstream = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      voice: safeVoice,
      input,
      response_format,
    }),
  });

  if (!upstream.ok) {
    let errMsg = "Falha na síntese de voz.";
    try {
      const j = (await upstream.json()) as { error?: { message?: string } };
      errMsg = j.error?.message?.trim() || errMsg;
    } catch {
      /* ignore */
    }
    return NextResponse.json({ error: errMsg }, { status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502 });
  }

  const buf = await upstream.arrayBuffer();
  const mime =
    response_format === "mp3"
      ? "audio/mpeg"
      : response_format === "opus"
        ? "audio/opus"
        : response_format === "aac"
          ? "audio/aac"
          : "application/octet-stream";

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Cache-Control": "no-store",
    },
  });
}
