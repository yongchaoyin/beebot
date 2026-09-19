// Manual, hidden Chromium regression: node tests/node-auth-browser.integration.mjs
// Uses only a temporary copy of the repository runtime and a temporary NodeAuth.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPackage, getRawHeader } from "@electron/asar";
import { build } from "esbuild";

if (process.platform !== "darwin") throw new Error("This manual browser regression currently uses the repository's macOS Electron runtime.");
const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(path.join(os.tmpdir(), "beebot-auth-chromium-"));
const servers = [];
let auth;
let browser;

function command(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let output = "";
    child.stdout.on("data", value => { output += value; if (options.report) process.stdout.write(value); });
    child.stderr.on("data", value => { output += value; });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`Owned test process timed out: ${path.basename(executable)}`)); }, 30_000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(`${path.basename(executable)} exited ${code}: ${output.slice(-6000)}`)); });
    if (options.browser) browser = child;
  });
}
async function listen(handler) {
  const server = createServer(handler); servers.push(server);
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return `http://127.0.0.1:${server.address().port}`;
}
async function post(origin, route, form, extra = {}) {
  return fetch(`${origin}${route}`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", ...extra }, body: new URLSearchParams(form), signal: AbortSignal.timeout(5000) });
}

try {
  const modulePath = path.join(temporary, "auth.mjs");
  await build({ entryPoints: [path.join(root, "source/node/auth.ts")], outfile: modulePath, bundle: true, platform: "node", format: "esm", target: "node26" });
  const { NodeAuth } = await import(pathToFileURL(modulePath).href);
  const requests = [];
  const origin = await listen(async (req, res) => {
    const url = new URL(req.url, origin);
    res.on("finish", () => {
      const request = { method: req.method, path: url.pathname, status: res.statusCode, origin: req.headers.origin, fetchSite: req.headers["sec-fetch-site"] };
      requests.push(request);
      if (req.method === "POST" && url.pathname === "/oauth/authorize") console.log("BROWSER_AUTHORIZATION_POST", JSON.stringify(request));
    });
    try { if (!await auth.handle(req, res, url)) { res.writeHead(404); res.end(); } }
    catch { res.writeHead(500); res.end("Authentication test failed"); }
  });
  auth = new NodeAuth({ dataDir: path.join(temporary, "node-data"), issuer: origin });
  const setup = await fetch(`${origin}/setup?code=${auth.getSetupInfo().code}`);
  const setupHtml = await setup.text();
  const form = {
    flow_id: /name="flow_id" value="([^"]+)"/.exec(setupHtml)[1],
    csrf: /name="csrf" value="([^"]+)"/.exec(setupHtml)[1],
    username: "browser-test-owner", password: "test-only-browser-regression-password",
  };
  const created = await post(origin, "/setup", form, { Origin: origin, Cookie: setup.headers.get("set-cookie").split(";")[0] });
  assert.equal(created.status, 200);

  let callback;
  let callbackReferer;
  const callbackOrigin = await listen((req, res) => {
    const url = new URL(req.url, callbackOrigin);
    if (url.pathname !== "/oauth/callback") { res.writeHead(404); res.end(); return; }
    callback = url;
    callbackReferer = req.headers.referer;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end("<!doctype html><title>Authorization browser test complete</title><p>Test callback received.</p>");
  });
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const redirect = `${callbackOrigin}/oauth/callback`;
  const authorization = new URL("/oauth/authorize", origin);
  authorization.search = new URLSearchParams({ client_id: "beebot-desktop", response_type: "code", redirect_uri: redirect, state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", scope: "owner:node", device_name: "Hidden Chromium regression" }).toString();

  const copiedApp = path.join(temporary, "BeeBot Auth Regression.app");
  await cp(path.join(root, ".cache/runtime/Grok Bot.app"), copiedApp, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
  const payload = path.join(temporary, "payload"); await mkdir(payload);
  await writeFile(path.join(payload, "package.json"), JSON.stringify({ name: "beebot-auth-browser-regression", version: "1.0.0", main: "main.cjs" }));
  await writeFile(path.join(temporary, "browser-config.json"), JSON.stringify({ userData: path.join(temporary, "browser-data"), authorization: authorization.href, redirect, username: form.username, password: form.password }), { mode: 0o600 });
  await writeFile(path.join(payload, "main.cjs"), String.raw`
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const config = JSON.parse(fs.readFileSync(process.env.BEEBOT_AUTH_REGRESSION_CONFIG, 'utf8'));
app.setName('BeeBot Auth Regression');
app.setPath('userData', config.userData);
app.setActivationPolicy('prohibited');
const timeout = setTimeout(() => { console.error('Hidden browser did not reach callback within 25 seconds'); app.exit(2); }, 25000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('console-message', (...args) => {
    const details = args.find(value => value && typeof value === 'object' && typeof value.message === 'string');
    if (details && /security policy|blocked|refused/i.test(details.message)) console.error('Chromium console:', details.message.replace(/http[^\s"']+/g, '[test URL]'));
  });
  win.webContents.on('did-navigate', (_event, url) => {
    if (url.startsWith(config.redirect + '?')) {
      console.log('CHROMIUM_CALLBACK_LOADED'); clearTimeout(timeout); app.exit(0);
    }
  });
  win.webContents.on('did-fail-load', (_event, code, description) => console.error('Chromium load:', code, description));
  console.log('HIDDEN_CHROMIUM_STARTED', JSON.stringify({ electron: process.versions.electron, chrome: process.versions.chrome, sandbox: true, webSecurity: true, contextIsolation: true, visible: false }));
  await win.loadURL(config.authorization);
  const preferences = win.webContents.getLastWebPreferences();
  if (preferences.webSecurity === false || preferences.sandbox !== true || preferences.contextIsolation !== true || preferences.nodeIntegration !== false) throw new Error('Unexpected browser protections');
  const inputs = JSON.stringify({ username: config.username, password: config.password });
  await win.webContents.executeJavaScript('(function(credentials) { const form = document.querySelector("form"); document.getElementById("username").value = credentials.username; document.getElementById("password").value = credentials.password; form.requestSubmit(form.querySelector("button[value=allow]")); })(' + inputs + ')');
}).catch(error => { console.error(error.message); clearTimeout(timeout); app.exit(1); });
`);
  const resources = path.join(copiedApp, "Contents/Resources");
  await rm(path.join(resources, "app.asar"));
  await createPackage(payload, path.join(resources, "app.asar"));
  const integrity = createHash("sha256").update(getRawHeader(path.join(resources, "app.asar")).headerString).digest("hex");
  const plist = path.join(copiedApp, "Contents/Info.plist");
  await command("/usr/bin/plutil", ["-replace", "CFBundleIdentifier", "-string", `com.beebot.auth-regression.${process.pid}`, plist]);
  await command("/usr/bin/plutil", ["-replace", "CFBundleDisplayName", "-string", "BeeBot Auth Regression", plist]);
  await command("/usr/bin/plutil", ["-replace", "LSUIElement", "-bool", "YES", plist]);
  await command("/usr/bin/plutil", ["-replace", "ElectronAsarIntegrity", "-json", JSON.stringify({ "Resources/app.asar": { algorithm: "SHA256", hash: integrity } }), plist]);
  await command("/usr/bin/codesign", ["--force", "--deep", "--timestamp=none", "--sign", "-", copiedApp]);
  const env = { ...process.env, BEEBOT_AUTH_REGRESSION_CONFIG: path.join(temporary, "browser-config.json") };
  delete env.ELECTRON_RUN_AS_NODE;
  await command(path.join(copiedApp, "Contents/MacOS/Grok Bot"), [], { env, browser: true, report: true });
  assert.ok(callback, "Chromium must reach the real callback server");
  assert.equal(callbackReferer, undefined, "The cross-origin callback must not receive an authorization-page Referer");
  assert.equal(callback.searchParams.get("state"), state); assert.equal(callback.searchParams.get("iss"), origin);
  assert.equal(callback.searchParams.get("error"), null);
  const tokenResponse = await post(origin, "/oauth/token", { client_id: "beebot-desktop", grant_type: "authorization_code", code: callback.searchParams.get("code"), redirect_uri: redirect, code_verifier: verifier });
  assert.equal(tokenResponse.status, 200);
  const tokens = await tokenResponse.json();
  assert.ok(auth.authenticate({ headers: { authorization: `Bearer ${tokens.access_token}` } }).principalId);
  assert.ok(requests.some(request => request.method === "POST" && request.path === "/oauth/authorize" && request.status === 303));
  console.log(JSON.stringify({ result: "PASS", browser: "hidden Chromium, normal security settings", authorizationPost: 303, loopbackCallback: 200, callbackRefererAbsent: true, pkceExchange: tokenResponse.status, requests }, null, 2));
} finally {
  if (browser?.exitCode === null) browser.kill("SIGKILL");
  for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  auth?.close();
  await rm(temporary, { recursive: true, force: true });
}
