export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt?: number;
};

export type ChatCompletionRequestMessage = {
  role: ChatRole;
  content: string;
};
