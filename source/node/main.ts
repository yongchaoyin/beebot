import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { configureNodeModel, initializeOrReuseConfig, loadConfig, type NodeInstallOptions } from "./config.js";
import { inspectNodeReadiness, loadSetupLink, parseNodeArguments, readModelCredential, readModelKeyInput, removeSetupLink, storeSetupLink, verifyNodeEndpoint } from "./installation.js";

const HELP = `BeeBot server

  node main.mjs init [--data-dir DIR] [--name NAME] [--public-url ORIGIN]
      [--bind-host HOST] [--trusted-proxy] [--if-absent]
  node main.mjs start [--data-dir DIR] [--setup-output console|file]
  node main.mjs doctor [--data-dir DIR]
  node main.mjs verify [--data-dir DIR]
  node main.mjs setup-link [--data-dir DIR]
  node main.mjs configure-model [--data-dir DIR] --base-url URL --model-id ID --api-key-stdin

Remote deployments require trusted HTTPS. init never replaces node identity.
configure-model reads the key from stdin, saves a private server-side file, and requires restart.
doctor inspects configuration; it does not claim a model, browser or desktop test passed.
setup-link is a sensitive operator command: never publish its output.`;

async function main(): Promise<void> {
  const [command = "help", ...args] = process.argv.slice(2);
  if (["help", "--help"].includes(command)) { console.log(HELP); return; }
  const flags = parseNodeArguments(command, args);
  const dataDir = path.resolve(String(flags["data-dir"] ?? process.env.BEEBOT_DATA_DIR ?? path.join(os.homedir(), ".beebot-node")));
  if (command === "init") {
    const options: NodeInstallOptions = {};
    if (flags.name) options.name = String(flags.name);
    if (flags["public-url"]) options.publicUrl = String(flags["public-url"]);
    if (flags["bind-host"]) options.bindHost = String(flags["bind-host"]);
    if (flags["trusted-proxy"]) options.tlsTermination = "trusted-proxy";
    const config = initializeOrReuseConfig(dataDir, options, flags["if-absent"] === true);
    console.log(JSON.stringify({ nodeId: config.nodeId, name: config.name, publicUrl: config.publicUrl }));
    return;
  }
  if (command === "configure-model") {
    if (!flags["base-url"] || !flags["model-id"] || flags["api-key-stdin"] !== true) throw new Error("Expected --base-url URL --model-id ID --api-key-stdin; do not put a key in command arguments.");
    configureNodeModel(dataDir, String(flags["base-url"]), String(flags["model-id"]), await readModelKeyInput(process.stdin));
    console.log("Model configuration saved on this server. Restart the Node service to apply it."); return;
  }
  const config = loadConfig(dataDir);
  if (command === "verify") {
    await verifyNodeEndpoint(config);
    console.log(JSON.stringify({ nodeId: config.nodeId, publicUrl: config.publicUrl, connection: "verified", execution: "not_tested" })); return;
  }
  if (command === "setup-link") { console.log(loadSetupLink(dataDir, config)); return; }
  const hostEntry = fileURLToPath(new URL("../dist/host/host-main.cjs", import.meta.url));
  const credential = readModelCredential(config.model, process.env);
  const readiness = inspectNodeReadiness(config, credential, hostEntry);
  if (command === "doctor") {
    console.log(JSON.stringify({ nodeId: config.nodeId, name: config.name, publicUrl: config.publicUrl, readiness }));
    process.exitCode = readiness.status === "configured" ? 0 : 2; return;
  }
  const { HostRuntime } = await import("./runtime.js");
  const { BeeBotServer } = await import("./server.js");
  const settings: Record<string, unknown> = config.model ? { version: 1, inferenceProvider: "custom", inferenceHttp: { baseUrl: config.model.baseUrl, modelId: config.model.modelId }, localAccountActive: true } : {};
  const env: NodeJS.ProcessEnv = credential.status === "available" ? { CUSTOM_API_KEY: credential.value } : {};
  const startedAt = Date.now();
  const runtime = new HostRuntime({ dataDir, hostEntry, settings, env });
  const server = new BeeBotServer({ config, dataDir, runtime });
  const privateSetup = flags["setup-output"] === "file";
  try {
    await server.listen();
    removeSetupLink(dataDir);
    console.log(`BeeBot ${config.name} listening on ${config.publicUrl}\nNode ID: ${config.nodeId}\nData: ${dataDir}`);
    if (readiness.status !== "configured") console.log(`Execution configuration: ${readiness.status}. Run doctor on this server for details.`);
    const setup = server.auth.getSetupInfo();
    if (setup.required && setup.code) {
      if (privateSetup) {
        // Conservative expiry within the authentication layer's ten-minute lifetime.
        storeSetupLink(dataDir, config.nodeId, config.publicUrl, setup.code, startedAt + 9 * 60_000);
        console.log("Owner setup required. Use the operator-only setup-link command; the link is not written to service logs.");
      } else console.log(`Create the owner account within 10 minutes: ${config.publicUrl}/setup?code=${encodeURIComponent(setup.code)}`);
    }
  } catch (error) { await server.close(); throw error; }
  if (privateSetup) server.http.on("request", (req, res) => {
    if (req.method !== "POST") return;
    try { if (new URL(req.url ?? "/", config.publicUrl).pathname !== "/setup") return; }
    catch { return; }
    res.once("finish", () => {
      try { if (!server.auth.getSetupInfo().required) removeSetupLink(dataDir); }
      catch { /* A shutdown may have closed the auth store; shutdown also removes the file. */ }
    });
  });
  const stop = () => { void server.close().then(() => {
    if (privateSetup) removeSetupLink(dataDir);
    process.exitCode = 0;
  }).catch(() => { console.error("BeeBot could not finish shutdown cleanly."); process.exitCode = 1; }); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
}
void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
