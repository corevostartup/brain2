/**
 * Nome de ficheiro para upload Whisper — a API valida o formato pelo conteúdo e pela extensão.
 * Safari grava `audio/mp4`; Chrome costuma usar `audio/webm`. Forçar `.webm` com blob MP4 gera
 * "Invalid file format" na API OpenAI.
 *
 * @see https://platform.openai.com/docs/guides/speech-to-text
 */
export function whisperUploadBasename(blob: Blob, mimeTypeHint?: string): string {
  const t = (blob.type || mimeTypeHint || "").trim().toLowerCase();

  if (t.includes("webm")) {
    return "recording.webm";
  }
  if (t.includes("wav")) {
    return "recording.wav";
  }
  if (t.includes("flac")) {
    return "recording.flac";
  }
  if (t.includes("mp4") || t.includes("m4a") || t.includes("quicktime") || t === "video/mp4") {
    return "recording.m4a";
  }
  if (t.includes("ogg") && !t.includes("webm")) {
    return "recording.ogg";
  }
  if (t.includes("mp3") || (t.includes("mpeg") && !t.includes("mp4"))) {
    return "recording.mp3";
  }
  if (t.includes("oga")) {
    return "recording.oga";
  }
  if (t.includes("mpga")) {
    return "recording.mpga";
  }

  return "recording.webm";
}
