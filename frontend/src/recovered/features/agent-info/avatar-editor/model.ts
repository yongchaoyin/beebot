import { COLORS as PRESENCE_COLORS } from "../../../../presence/avatar-art";
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=2747995 (Amt image normalization; SHA256 ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=2748503 (qUe file decoding; SHA256 ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=2748774 (jUe 256px PNG export; SHA256 ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=3495159 (Amt image normalization; SHA256 80464803b50f478598080bdc1b91da3996c6b74168e2351ea26f620f2ec62ba5)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=3495766 (qUe file decoding; SHA256 80464803b50f478598080bdc1b91da3996c6b74168e2351ea26f620f2ec62ba5)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=3496141 (jUe 256px PNG export; SHA256 80464803b50f478598080bdc1b91da3996c6b74168e2351ea26f620f2ec62ba5)

export const AVATAR_SOURCE_MAX_BYTES = 25 * 1024 * 1024;
export const AVATAR_SOURCE_MAX_DIMENSION = 1_024;
export const AVATAR_OUTPUT_SIZE = 256;
export const AVATAR_STAGE_SIZE = 260;
export const AVATAR_MIN_ZOOM = 1;
export const AVATAR_MAX_ZOOM = 5;

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=22574 (PQ character palette; SHA256 ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=22574 (PQ character palette; SHA256 80464803b50f478598080bdc1b91da3996c6b74168e2351ea26f620f2ec62ba5)
export const AVATAR_COLORS = [
  { id: "black", label: "Slate", value: PRESENCE_COLORS.black },
  { id: "brown", label: "Stone", value: PRESENCE_COLORS.brown },
  { id: "red", label: "Rose", value: PRESENCE_COLORS.red },
  { id: "orange", label: "Dusk", value: PRESENCE_COLORS.orange },
  { id: "yellow", label: "Cloud", value: PRESENCE_COLORS.yellow },
  { id: "green", label: "Sage", value: PRESENCE_COLORS.green },
  { id: "cyan", label: "Mist", value: PRESENCE_COLORS.cyan },
  { id: "blue", label: "Blue", value: PRESENCE_COLORS.blue },
  { id: "violet", label: "Lilac", value: PRESENCE_COLORS.violet },
  { id: "magenta", label: "Blush", value: PRESENCE_COLORS.magenta },
  { id: "gray", label: "Gray", value: PRESENCE_COLORS.gray },
] as const;

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=22691 (Ij character shapes; SHA256 ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=22691 (Ij character shapes; SHA256 80464803b50f478598080bdc1b91da3996c6b74168e2351ea26f620f2ec62ba5)
export const AVATAR_SHAPES = ["blob", "pebble", "squircle", "tablet", "wedge", "hex", "cloud", "teardrop"] as const;

export interface AvatarCharacter {
  readonly avatarShape: string | null;
  readonly avatarColor: string | null;
}

export interface AvatarImage {
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
}

export interface AvatarCrop {
  readonly zoom: number;
  readonly centerX: number;
  readonly centerY: number;
}

export interface AvatarImageCodec {
  normalizeDataUrl(dataUrl: string): Promise<AvatarImage>;
  readFile(file: File): Promise<string>;
  encodePng(source: AvatarImage, crop: AvatarCrop): Promise<string>;
}

export function initialAvatarCrop(width: number, height: number): AvatarCrop {
  return { zoom: AVATAR_MIN_ZOOM, centerX: width / 2, centerY: height / 2 };
}

export function clampAvatarZoom(value: number): number {
  return Number.isFinite(value) ? Math.min(AVATAR_MAX_ZOOM, Math.max(AVATAR_MIN_ZOOM, value)) : AVATAR_MIN_ZOOM;
}

export function visibleAvatarSide(source: Pick<AvatarImage, "width" | "height">, zoom: number): number {
  return Math.min(source.width, source.height) / clampAvatarZoom(zoom);
}

export function clampAvatarCrop(source: Pick<AvatarImage, "width" | "height">, crop: AvatarCrop): AvatarCrop {
  const zoom = clampAvatarZoom(crop.zoom);
  const side = visibleAvatarSide(source, zoom) / 2;
  return {
    zoom,
    centerX: Math.min(source.width - side, Math.max(side, crop.centerX)),
    centerY: Math.min(source.height - side, Math.max(side, crop.centerY)),
  };
}

export function panAvatarCrop(source: AvatarImage, crop: AvatarCrop, deltaX: number, deltaY: number): AvatarCrop {
  const zoom = clampAvatarZoom(crop.zoom);
  const scale = AVATAR_STAGE_SIZE / Math.min(source.width, source.height) * zoom;
  return clampAvatarCrop(source, {
    zoom,
    centerX: crop.centerX - deltaX / scale,
    centerY: crop.centerY - deltaY / scale,
  });
}

export function avatarCropRect(source: AvatarImage, crop: AvatarCrop): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const bounded = clampAvatarCrop(source, crop);
  const side = visibleAvatarSide(source, bounded.zoom);
  return { x: bounded.centerX - side / 2, y: bounded.centerY - side / 2, width: side, height: side };
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => image.naturalWidth > 0 && image.naturalHeight > 0 ? resolve(image) : reject(new Error("That image could not be loaded."));
    image.onerror = () => reject(new Error("That image could not be loaded."));
    image.src = dataUrl;
  });
}

function canvasContext(canvas: HTMLCanvasElement, message = "Could not export the avatar."): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (context == null) throw new Error(message);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return context;
}

async function normalizeDataUrl(dataUrl: string): Promise<AvatarImage> {
  const image = await loadImage(dataUrl);
  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  if (longest <= AVATAR_SOURCE_MAX_DIMENSION) return { dataUrl, width: image.naturalWidth, height: image.naturalHeight };
  const scale = AVATAR_SOURCE_MAX_DIMENSION / longest;
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvasContext(canvas, "That image could not be loaded.").drawImage(image, 0, 0, width, height);
  return { dataUrl: canvas.toDataURL("image/png"), width, height };
}

function readFile(file: File): Promise<string> {
  if (file.size > AVATAR_SOURCE_MAX_BYTES) return Promise.reject(new Error("Choose an image smaller than 25 MB."));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("That file could not be read."));
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.readAsDataURL(file);
  });
}

async function encodePng(source: AvatarImage, crop: AvatarCrop): Promise<string> {
  const image = await loadImage(source.dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_OUTPUT_SIZE;
  canvas.height = AVATAR_OUTPUT_SIZE;
  const rect = avatarCropRect(source, crop);
  canvasContext(canvas).drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
  const dataUrl = canvas.toDataURL("image/png");
  const comma = dataUrl.indexOf(",");
  const base64 = comma < 0 ? "" : dataUrl.slice(comma + 1);
  if (base64.length === 0) throw new Error("Could not export the avatar.");
  return base64;
}

export const browserAvatarImageCodec: AvatarImageCodec = { normalizeDataUrl, readFile, encodePng };
