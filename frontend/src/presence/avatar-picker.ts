import { mountAvatarExpressionControls } from "./avatar-preview.ts";
import type { AvatarExpression } from "./avatar-expression.ts";
import { AVATAR_SHAPES, COLORS, COLOR_LABELS, SHAPE_LABELS, avatarForeground, characterLayers, characterVariant, createCharacterSvg } from "./avatar-art.ts";
import { registerAvatarMotion } from "./avatar-motion.ts";

export interface AvatarPickerValue { readonly shape: string; readonly color: string }
export interface AvatarPickerOptions extends AvatarPickerValue {
  readonly language: "en" | "zh";
  readonly disabled?: boolean;
  onChange(value: AvatarPickerValue): void;
}

const STYLE_ID = "bb-avatar-picker-style";
const STYLE = `
.bb-avatar-picker{display:grid;gap:14px;width:100%;min-width:0;margin:0 0 16px;font:inherit;color:var(--cursor-text-primary,CanvasText)}
.bb-avatar-picker *{box-sizing:border-box}
.bb-avatar-picker__preview{display:flex;align-items:center;gap:14px;min-height:88px}
.bb-avatar-picker__preview>svg{flex:none;width:88px;height:88px}
.bb-avatar-picker__summary{display:grid;gap:5px;min-width:0}
.bb-avatar-picker__summary strong{font-size:13px;font-weight:500;overflow-wrap:anywhere}
.bb-avatar-picker__summary small{font-size:12px;line-height:1.5;color:var(--cursor-text-secondary,GrayText)}
.bb-avatar-picker fieldset{border:0;margin:0;padding:0;min-width:0}
.bb-avatar-picker legend{padding:0;margin-bottom:8px;font-size:12px;font-weight:500;color:var(--cursor-text-secondary,GrayText)}
.bb-avatar-picker__choices{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.bb-avatar-picker__choices[data-kind=color]{grid-template-columns:repeat(6,minmax(0,1fr))}
.bb-avatar-picker .bb-avatar-picker__choice{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px;min-width:0;min-height:44px;padding:5px 2px;margin:0;border:2px solid transparent;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:11px;line-height:1.3;cursor:pointer;box-shadow:none}
.bb-avatar-picker__choice>svg{width:32px;height:32px;flex:none}
.bb-avatar-picker__choice>span:last-child{overflow-wrap:anywhere}
.bb-avatar-picker .bb-avatar-picker__choice[aria-checked=true]{border-color:var(--cursor-accent,Highlight);background:var(--cursor-bg-secondary,Canvas)}
.bb-avatar-picker .bb-avatar-picker__choice:hover{background:var(--cursor-bg-secondary,Canvas)}
.bb-avatar-picker .bb-avatar-picker__choice:focus-visible{outline:2px solid var(--cursor-accent,Highlight);outline-offset:2px}
.bb-avatar-picker .bb-avatar-picker__choice:disabled{opacity:.5;cursor:default}
.bb-avatar-picker__swatch{display:grid;place-items:center;width:26px;height:26px;border:1px solid rgb(0 0 0 / .15);border-radius:50%;color:#273347;font-size:16px;font-weight:700}
.bb-avatar-picker__color-name{display:block;margin-top:6px;font-size:12px;color:var(--cursor-text-secondary,GrayText)}
@media(max-width:360px){.bb-avatar-picker__choices{grid-template-columns:repeat(4,minmax(0,1fr))}.bb-avatar-picker__choices[data-kind=color]{grid-template-columns:repeat(6,minmax(0,1fr))}}
@media(forced-colors:active){.bb-avatar-picker .bb-avatar-picker__choice{border:1px solid ButtonText}.bb-avatar-picker .bb-avatar-picker__choice[aria-checked=true]{outline:2px solid Highlight}.bb-avatar-picker__swatch{forced-color-adjust:none}}
`;

/** Shared DOM adapter for the React creation sheet and the pinned native dialog.
 * It edits appearance only: callers own creation, persistence and pending state.
 * No independent animation loop or motion preference is introduced here. */
export function mountAvatarPicker(host: HTMLElement, options: AvatarPickerOptions) {
  const document = host.ownerDocument;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style"); style.id = STYLE_ID; style.textContent = STYLE;
    document.head.append(style);
  }
  let value: AvatarPickerValue = { shape: options.shape, color: options.color };
  let language = options.language, disabled = options.disabled === true, disposed = false;
  let expression: AvatarExpression = "idle";
  const element = document.createElement("section"); element.className = "bb-avatar-picker";
  const preview = document.createElement("div"); preview.className = "bb-avatar-picker__preview";
  const svg = createCharacterSvg(document, value.shape, value.color, 88);
  const summary = document.createElement("div"); summary.className = "bb-avatar-picker__summary";
  const selected = document.createElement("strong"), help = document.createElement("small");
  summary.append(selected, help); preview.append(svg, summary); element.append(preview);
  const groups = new Map<"shape" | "color", { legend: HTMLLegendElement; group: HTMLDivElement; buttons: HTMLButtonElement[] }>();
  const colorName = document.createElement("small"); colorName.className = "bb-avatar-picker__color-name";
  const label = (labels: readonly [string, string]) => labels[language === "zh" ? 1 : 0];
  const canonicalShape = () => AVATAR_SHAPES[characterVariant(value.shape)] ?? "blob";
  const selectedColor = () => Object.hasOwn(COLOR_LABELS, value.color) ? value.color : Object.keys(COLOR_LABELS).find(key => COLORS[key] === COLORS[value.color]) ?? "blue";

  const choose = (kind: "shape" | "color", key: string) => {
    if (disabled || disposed || value[kind] === key) return;
    value = { ...value, [kind]: key };
    paint();
    options.onChange({ ...value });
  };
  for (const kind of ["shape", "color"] as const) {
    const fieldset = document.createElement("fieldset"), legend = document.createElement("legend");
    const group = document.createElement("div"); group.className = "bb-avatar-picker__choices";
    group.dataset.kind = kind; group.setAttribute("role", "radiogroup");
    const keys = kind === "shape" ? AVATAR_SHAPES : Object.keys(COLOR_LABELS);
    const buttons = keys.map(key => {
      const button = document.createElement("button"); button.type = "button";
      button.className = "bb-avatar-picker__choice"; button.dataset.value = key;
      button.dataset.createField = `avatar-${kind}-${key}`; button.setAttribute("role", "radio");
      if (kind === "shape") {
        const icon = createCharacterSvg(document, key, value.color, 32); icon.dataset.paused = "true";
        button.append(icon, document.createElement("span"));
      } else {
        const swatch = document.createElement("span"); swatch.className = "bb-avatar-picker__swatch";
        swatch.style.backgroundColor = COLORS[key]; swatch.style.color = avatarForeground(key); swatch.setAttribute("aria-hidden", "true"); button.append(swatch);
      }
      button.addEventListener("click", () => { if (!button.disabled) choose(kind, key); });
      group.append(button); return button;
    });
    // One Tab stop per group; arrow keys select without submitting or closing it.
    group.addEventListener("keydown", event => {
      if (disabled || disposed || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      const index = buttons.indexOf(event.target as HTMLButtonElement);
      if (index < 0) return;
      let target: number;
      if (event.key === "Home") target = 0;
      else if (event.key === "End") target = buttons.length - 1;
      else if (["ArrowRight", "ArrowDown"].includes(event.key)) target = (index + 1) % buttons.length;
      else if (["ArrowLeft", "ArrowUp"].includes(event.key)) target = (index - 1 + buttons.length) % buttons.length;
      else return;
      event.preventDefault(); event.stopPropagation();
      buttons[target].focus({ preventScroll: true }); buttons[target].click();
    });
    fieldset.append(legend, group); element.append(fieldset); groups.set(kind, { legend, group, buttons });
    if (kind === "color") fieldset.append(colorName);
  }
  host.append(element);
  // Register only the main preview. Choice thumbnails never consume motion slots.
  const motion = registerAvatarMotion(svg, { state: "idle", size: 88, priority: 100, followingPointer: true, paused: disabled });
  const controls = mountAvatarExpressionControls(element, {
    expression(next) { expression=next; motion.update({state:expression,shape:value.shape,size:88,priority:120,followingPointer:true,paused:disabled}); },
    gesture(kind) { motion.gesture(kind); },
    reset() {motion.reset();},
  }, language, disabled);
  function paint() {
    if (disposed) return;
    const shape = canonicalShape(), color = selectedColor();
    const shapeLabel = label(SHAPE_LABELS[shape]), colorLabel = label(COLOR_LABELS[color]);
    element.setAttribute("aria-label", language === "zh" ? "Bot 头像" : "Bot avatar");
    selected.textContent = `${shapeLabel} · ${colorLabel}`;
    help.textContent = language === "zh" ? "动作沿用当前设置，创建后仍可修改外观。" : "Uses your current motion settings. Appearance can be changed later.";
    colorName.textContent = (language === "zh" ? "当前颜色：" : "Selected color: ") + colorLabel;
    preview.setAttribute("aria-label", (language === "zh" ? "头像预览：" : "Avatar preview: ") + selected.textContent);
    // Preserve the SVG, eyes and mouth nodes, so selection does not restart motion.
    const layers = characterLayers(value.shape, value.color, expression, 88);
    svg.querySelectorAll("[data-part]").forEach((node, index) => {
      for (const [key, attribute] of Object.entries(layers[index].attrs)) node.setAttribute(key, String(attribute));
    });
    svg.dataset.variant = String(characterVariant(value.shape));
    motion.update({state:expression,shape:value.shape,size:88,priority:120,followingPointer:true,paused:disabled});
    for (const [kind, { legend, group, buttons }] of groups) {
      const heading = kind === "shape" ? (language === "zh" ? "形状" : "Shape") : (language === "zh" ? "颜色" : "Color");
      legend.textContent = heading; group.setAttribute("aria-label", heading);
      for (const button of buttons) {
        const key = button.dataset.value!;
        const text = label((kind === "shape" ? SHAPE_LABELS : COLOR_LABELS)[key]);
        const checked = key === (kind === "shape" ? shape : color);
        button.setAttribute("aria-label", text); button.title = text;
        button.setAttribute("aria-checked", String(checked)); button.tabIndex = checked ? 0 : -1; button.disabled = disabled;
        if (kind === "shape") {
          button.querySelector("span")!.textContent = text;
          // Face contrast changes with color too; keep every thumbnail node stable.
          const thumbnailLayers = characterLayers(key, value.color);
          button.querySelectorAll("[data-part]").forEach((node, index) => {
            for (const [attribute, value] of Object.entries(thumbnailLayers[index].attrs)) node.setAttribute(attribute, String(value));
          });
        } else button.querySelector("span")!.textContent = checked ? "✓" : "";
      }
    }
  }
  paint();
  return {
    setValue(next: AvatarPickerValue) { if (disposed) return; value = { ...next }; paint(); },
    setLanguage(next: "en" | "zh") { if (disposed) return; language = next; controls.setLanguage(next); paint(); },
    setDisabled(next: boolean) {
      if (disposed || disabled === next) return; disabled = next; controls.setDisabled(next); paint();
      motion.update({ state: expression, shape:value.shape, size: 88, priority: 120, followingPointer: true, paused: disabled });
    },
    destroy() { if (disposed) return; disposed = true; controls.destroy(); motion.destroy(); element.remove(); },
  };
}
