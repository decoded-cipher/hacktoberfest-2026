import OpenAI from "openai";

export interface LlmClientOptions {
  baseURL: string;
  apiKey: string;
  model: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Thin wrapper over any OpenAI-compatible server (Ollama locally, a hosted open-weight model in production). */
export class LlmClient {
  readonly model: string;
  readonly #openai: OpenAI;

  constructor(options: LlmClientOptions) {
    this.model = options.model;
    this.#openai = new OpenAI({ baseURL: options.baseURL, apiKey: options.apiKey });
  }

  async complete(messages: ChatMessage[], options: { temperature?: number } = {}): Promise<string> {
    const res = await this.#openai.chat.completions.create({
      model: this.model,
      messages,
      temperature: options.temperature ?? 0,
    });
    return stripThinking(res.choices[0]?.message.content ?? "");
  }
}

/** Reasoning models (e.g. Qwen3) may prepend a <think>…</think> block; drop it. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
