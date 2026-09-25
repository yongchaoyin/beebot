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
