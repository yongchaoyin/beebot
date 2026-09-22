import { forwardRef } from "react";
import type { OnboardingCharacterVisualProps } from "./view";
import { PresenceCharacter } from "../../../../honeyline/components";
import { COLORS, SHAPES, characterVariant } from "../../../../presence/avatar-art";

// Preserve existing persona keys/seeded identity, not the old drawing or RAF loop.
const SHIPPED_SHAPES = ["blob", "pebble", "squircle", "tablet", "wedge", "hex", "cloud", "teardrop"] as const;
function shippedRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = value + 1831565813 | 0;
    let next = Math.imul(value ^ value >>> 15, 1 | value);
    next = next + Math.imul(next ^ next >>> 7, 61 | next) ^ next;
    return ((next ^ next >>> 14) >>> 0) / 4294967296;
  };
}
function shippedHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}
function shippedColorIndex(value: string): number {
  const seed = (shippedHash(value) ^ Math.imul(1, 2654435769)) >>> 0;
  return Math.floor(shippedRandom((seed ^ 2654435769) >>> 0)() * 10);
}
function shippedShapeHash(value: string): number {
  let hash = shippedHash(value);
  hash = Math.imul(hash ^ hash >>> 16, 73244475);
  hash = Math.imul(hash ^ hash >>> 13, 3266489909);
  return (hash ^ hash >>> 16) >>> 0;
}
export function resolvePersonaColor(agentId: string, color?: string | null): string {
  if (color != null && Object.hasOwn(COLORS, color)) return color;
  return ["brown", "red", "orange", "yellow", "green", "cyan", "blue", "violet", "magenta", "gray"][shippedColorIndex(agentId)] ?? "gray";
}
export function resolvePersonaShape(agentId: string, shape?: string | null): string {
  if (shape != null && (SHIPPED_SHAPES as readonly string[]).includes(shape)) return shape;
  return SHIPPED_SHAPES[shippedShapeHash(agentId) % SHIPPED_SHAPES.length] ?? "blob";
}

export const PERSONA_SHAPE_PATHS = Object.fromEntries(SHIPPED_SHAPES.map(shape => [shape, SHAPES[characterVariant(shape)]]));
export const personaShapePath = (shape: string) => SHAPES[characterVariant(shape)];
export interface OnboardingCharacterHandle { spin(): void; bounce(): void; burst(): void; }
export const OnboardingCharacter = forwardRef<OnboardingCharacterHandle, OnboardingCharacterVisualProps>(function OnboardingCharacter(props, ref) {
  return <PresenceCharacter {...props} ref={ref} surface="onboarding" />;
});
export function defaultOnboardingCharacterRenderer(props: OnboardingCharacterVisualProps) {
  return <OnboardingCharacter {...props} />;
}
