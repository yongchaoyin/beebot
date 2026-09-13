import { jsonSchema } from "ai";
import { zodToJsonSchema } from "zod-to-json-schema";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function isZodSchema(value: unknown): boolean {
  return isRecord(value) && "_def" in value;
}

export function resolveHttpToolParameters(value: unknown): ReturnType<typeof jsonSchema> | undefined {
  if (!isRecord(value)) return undefined;
  const wrapped = value.jsonSchema;
  if (isZodSchema(wrapped)) {
    try { return jsonSchema(zodToJsonSchema(wrapped as never) as never); } catch { return undefined; }
  }
  if (isRecord(wrapped) && !("_def" in wrapped)) return value as ReturnType<typeof jsonSchema>;
  if (isZodSchema(value)) {
    try { return jsonSchema(zodToJsonSchema(value as never) as never); } catch { return undefined; }
  }
  if (typeof value.type === "string" || isRecord(value.properties)) {
    try { return jsonSchema(value as never); } catch { return undefined; }
  }
  return undefined;
}

export async function* withSyntheticSendMessage<T extends { type: string }>(
  stream: AsyncIterable<T>,
): AsyncGenerator<T | {
  readonly type: "tool-call";
  readonly toolCallId: string;
  readonly toolName: "SendMessage";
  readonly args: { readonly type: "text"; readonly content: string };
}> {
  let text = "";
  let toolCall = false;
  for await (const chunk of stream) {
    if (chunk.type === "text-delta" && "textDelta" in chunk && typeof chunk.textDelta === "string") text += chunk.textDelta;
    if (chunk.type === "tool-call" || chunk.type === "tool-call-streaming-start" || chunk.type === "tool-call-delta") toolCall = true;
    yield chunk;
  }
  const content = text.trim();
  if (!toolCall && content.length > 0) {
    yield {
      type: "tool-call",
      toolCallId: `synthetic-send-${Date.now()}`,
      toolName: "SendMessage",
      args: { type: "text", content },
    };
  }
}
