import OpenAI from "openai";
import { z } from "zod";

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

  /** Ask for JSON matching `schema` (enforced server-side where supported) and validate it. */
  async completeJson<S extends z.ZodType>(
    messages: ChatMessage[],
    schema: S,
    name: string,
  ): Promise<z.infer<S>> {
    const res = await this.#openai.chat.completions.create({
      model: this.model,
      messages,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: { name, schema: z.toJSONSchema(schema), strict: true },
      },
    });
    const text = stripThinking(res.choices[0]?.message.content ?? "");
    return schema.parse(JSON.parse(extractJson(text)));
  }
}

/** Reasoning models (e.g. Qwen3) may prepend a <think>…</think> block; drop it. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/** Tolerate code fences or chatter around a JSON object. */
export function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}
