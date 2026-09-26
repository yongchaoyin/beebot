import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { UI_ZH_TRANSLATIONS } from "../scripts/lib/ui-language-catalog.mjs";

const source = await readFile(new URL("../scripts/lib/router-renderer-patch.mjs", import.meta.url), "utf8");
const start = source.indexOf("function RBoxRuntime(){"), end = source.indexOf("\nfunction RLanguageRow()", start);
assert.ok(start >= 0 && end > start);
const render = new Function("de", "a", "ie", "se", "window", `${source.slice(start, end)};return RBoxRuntime();`);
const statuses = [
  ["Local Docker VM is ready.", "本机 Docker 虚拟机已就绪。"],
  ["Container is starting.", "容器正在启动。"],
  ["Local Docker VM is stopped.", "本机 Docker 虚拟机已停止。"],
  ["Ready to create the local VM.", "已准备好创建本机虚拟机。"],
  ["Docker is not running.", "Docker 未运行。"],
  ["Docker is not installed.", "未安装 Docker。"],
  ["Container grok-bot-local-vm exists but is not owned by BeeBot.", "容器 grok-bot-local-vm 已存在，但不由 BeeBot 管理。"],
];
function description(detail, { language = "zh", bridge = true, mode = "local-docker" } = {}) {
  const calls = [], state = Object.freeze({ mode, status: Object.freeze({ detail }), error: null, busy: false });
  const jsx = (type, props) => ({ type, props });
  const win = bridge ? { __beebotUiLanguage: { text(value) {
    calls.push(value); return language === "zh" ? UI_ZH_TRANSLATIONS[value] ?? value : value;
  } } } : undefined;
  const result = render({ useState: () => [state, () => {}], useEffect() {} }, { jsx, jsxs: jsx }, "field", "text", win);
  return { value: result.props.children[0].props.description, calls, state };
}

test("owned local Docker status details translate by exact display whitelist and keep server facts unchanged", () => {
  for (const [english, chinese] of statuses) {
    assert.equal(UI_ZH_TRANSLATIONS[english], chinese, "the shipped catalog must contain the actual status string");
    const zh = description(english); assert.equal(zh.value, chinese); assert.deepEqual(zh.calls, [english]);
    assert.equal(zh.state.status.detail, english, "localization does not mutate the backend status");
    const en = description(english, { language: "en" }); assert.equal(en.value, english);
  }
});

test("unknown diagnostics and user-like copy never enter the general translation catalog", () => {
  for (const detail of ["General", "Close", "Docker daemon permission denied: /private/example.sock", "Local Docker VM is ready.\nbackend detail", " Local Docker VM is ready.", "Local Docker VM is ready. ", "Container another-name exists but is not owned by BeeBot.", ""]) {
    const result = description(detail); assert.equal(result.value, detail); assert.deepEqual(result.calls, []);
  }
});

test("rendering without the language adapter preserves details and missing-status fallback", () => {
  for (const [english] of statuses) assert.equal(description(english, { bridge: false }).value, english);
  for (const detail of [undefined, null]) {
    const result = description(detail, { bridge: false });
    assert.equal(result.value, "Shell, files and computer use run in a Docker container on this Mac."); assert.deepEqual(result.calls, []);
  }
});

test("remote provider mode does not translate or consume a stale local Docker status", () => {
  const result = description("Local Docker VM is ready.", { mode: "remote" });
  assert.equal(result.value, "This uses the external provider's hosted computer, not a separately connected BeeBot server. Provider access is required.");
  assert.deepEqual(result.calls, []);
});
