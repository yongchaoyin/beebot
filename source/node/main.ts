import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { initializeConfig, loadConfig } from "./config.js";
import { HostRuntime } from "./runtime.js";
import { BeeBotServer } from "./server.js";

async function main(): Promise<void> {
  const [command = "help", ...args] = process.argv.slice(2);
  if (!["init", "start"].includes(command)) {
    console.log("BeeBot server\n\n  node main.mjs init [--data-dir DIR]\n  node main.mjs start [--data-dir DIR]\n\nConfigure the model and HTTPS public URL in DIR/node.json before remote deployment.");
    if (command !== "help" && command !== "--help") process.exitCode = 1;
    return;
  }
  if (args.length && (args[0] !== "--data-dir" || args.length !== 2 || !args[1])) throw new Error("Expected --data-dir DIR");
  const dataDir = path.resolve(args[1] ?? process.env.BEEBOT_DATA_DIR ?? path.join(os.homedir(), ".beebot-node"));
  if (command === "init") {
    initializeConfig(dataDir);
    console.log(`Initialized ${path.join(dataDir, "node.json")}\nAdd a model configuration, then run start with the same data directory.`); return;
  }
  const config = loadConfig(dataDir);
  const settings: Record<string, unknown> = config.model ? { version: 1, inferenceProvider: "custom", inferenceHttp: { baseUrl: config.model.baseUrl, modelId: config.model.modelId }, localAccountActive: true } : {};
  const env: NodeJS.ProcessEnv = {};
  if (config.model) {
    const key = process.env[config.model.apiKeyEnv];
    if (key) env.CUSTOM_API_KEY = key;
  }
  const runtime = new HostRuntime({ dataDir, hostEntry: fileURLToPath(new URL("../dist/host/host-main.cjs", import.meta.url)), settings, env });
  const server = new BeeBotServer({ config, dataDir, runtime });
  try { await server.listen(); } catch (error) { await server.close(); throw error; }
  console.log(`BeeBot ${config.name} listening on ${config.publicUrl}\nNode ID: ${config.nodeId}\nData: ${dataDir}`);
  if (!config.model) console.log("Model not configured: add model.baseUrl, model.modelId and model.apiKeyEnv to node.json, then restart before running goals.");
  const setup = server.auth.getSetupInfo();
  if (setup.required) console.log(`Create the owner account within 10 minutes: ${config.publicUrl}/setup?code=${encodeURIComponent(setup.code!)}`);
  const stop = () => { void server.close().then(() => { process.exitCode = 0; }).catch(error => { console.error(error); process.exitCode = 1; }); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
}
void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
