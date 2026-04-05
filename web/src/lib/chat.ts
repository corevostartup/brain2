export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

export type ChatCompletionRequestMessage = {
  role: ChatRole;
  content: string;
};
