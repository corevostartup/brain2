/**
 * Transcrição via OpenAI Whisper (servidor `/api/transcribe`) — mais precisa que Web Speech API.
 * Usa a mesma API key que o chat; há custo por minuto de áudio no lado OpenAI.
 */

import { whisperUploadBasename } from "@/lib/whisperAudioFilename";

export type TranscribeAudioOptions = {
  /** MIME do `MediaRecorder` (ex.: Safari `audio/mp4`) — alinha a extensão do ficheiro com o conteúdo. */
  mimeTypeHint?: string;
};

export async function transcribeAudioBlobWithOpenAI(
  audioBlob: Blob,
  apiKey: string,
  options?: TranscribeAudioOptions,
): Promise<string> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    throw new Error("API key em falta.");
  }
  if (!audioBlob || audioBlob.size < 32) {
    throw new Error("Áudio demasiado curto.");
  }

  const hint = options?.mimeTypeHint?.trim();
  const basename = whisperUploadBasename(audioBlob, hint);
  const formData = new FormData();
  formData.append("file", audioBlob, basename);
  formData.append("apiKey", trimmedKey);
  if (hint) {
    formData.append("mimeTypeHint", hint);
  }

  const response = await fetch("/api/transcribe", {
    method: "POST",
    body: formData,
  });

  const data = (await response.json()) as { text?: string; error?: string };
  if (!response.ok) {
    throw new Error(data.error || "Falha ao transcrever.");
  }
  const text = data.text?.trim() ?? "";
  if (!text) {
    throw new Error("Transcrição vazia.");
  }
  return text;
}
