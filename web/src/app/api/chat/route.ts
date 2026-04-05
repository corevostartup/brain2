import { NextResponse } from "next/server";
import type { ChatCompletionRequestMessage } from "@/lib/chat";

export const runtime = "nodejs";

type ChatRequestBody = {
  model?: string;
  apiKey?: string;
  messages?: ChatCompletionRequestMessage[];
};

type OpenAIChoice = {
  message?: {
    content?: string | Array<{ type?: string; text?: string }>;
  };
};

type OpenAIResponse = {
  choices?: OpenAIChoice[];
  error?: { message?: string };
};

function normalizeMessages(messages: ChatCompletionRequestMessage[]): ChatCompletionRequestMessage[] {
  return messages
    .filter((message) => typeof message.content === "string" && message.content.trim().length > 0)
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }));
}

function extractAssistantText(payload: OpenAIResponse): string {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const joined = content
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text?.trim() ?? "")
      .filter(Boolean)
      .join("\n");
    return joined;
  }

  return "";
}

export async function POST(request: Request) {
  let body: ChatRequestBody;

  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  const model = body.model?.trim();
  const apiKey = body.apiKey?.trim();
  const messages = normalizeMessages(body.messages ?? []);

  if (!model) {
    return NextResponse.json({ error: "Modelo LLM não informado." }, { status: 400 });
  }

  if (!apiKey) {
    return NextResponse.json({ error: "API key não informada." }, { status: 400 });
  }

  if (messages.length === 0) {
    return NextResponse.json({ error: "Nenhuma mensagem para enviar." }, { status: 400 });
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    }),
  });

  let payload: OpenAIResponse | null = null;
  try {
    payload = (await response.json()) as OpenAIResponse;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const providerError = payload?.error?.message?.trim();
    return NextResponse.json(
      { error: providerError || "Falha na chamada do provedor LLM." },
      { status: response.status || 502 }
    );
  }

  const assistantMessage = payload ? extractAssistantText(payload) : "";
  if (!assistantMessage) {
    return NextResponse.json(
      { error: "Resposta vazia do modelo." },
      { status: 502 }
    );
  }

  return NextResponse.json(
    { message: assistantMessage },
    { status: 200 }
  );
}
