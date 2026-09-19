/** Standalone service composition using the same reviewed runtime as the desktop build. */
import { startProductionHost } from "../host/main.js";
import { bindRecoveredProductionExtensions } from "../host/host-production-extensions.js";
import { executeBoxCopyInFromEnv } from "../host/extensions/box-store-sync/box-copy-in.js";
import { productionBoxGeneratedPorts } from "../host/box/generated-production.js";
import {
  convertProductionCloudAgentConversationToTrace,
  createProductionStateBackstop,
  productionSecretsContext,
} from "../host/production-binding-providers.js";
import { createProductionRunnerContext } from "../host/runner-context-production-provider.js";
import { createDefaultProductionTranscriptMirrorProvider } from "../host/transcript-mirror/production-provider.js";
import { productionLocalExecCodec } from "../host/extensions/local-exec/production.js";

const supervised = typeof process.send === "function";

void startProductionHost(bindRecoveredProductionExtensions({
  executeBoxCopyInFromEnv,
  extensionHost: {
    boxGenerated: productionBoxGeneratedPorts,
    convertCloudAgentConversationToTrace: convertProductionCloudAgentConversationToTrace,
  },
  runnerContext: createProductionRunnerContext(),
  createTranscriptMirror: createDefaultProductionTranscriptMirrorProvider(),
}, {
  stateBackstop: createProductionStateBackstop(),
  localExecCodec: productionLocalExecCodec,
  secretsContext: productionSecretsContext,
})).then(() => {
  if (!supervised) return;
  // A killed controller must not leave its detached Bot runtime executing jobs.
  // Install this after main's shutdown handlers; an early disconnect is noticed
  // by connected=false once startup has installed those handlers.
  const orphaned = () => { process.kill(process.pid, "SIGTERM"); };
  if (!process.connected) orphaned();
  else process.once("disconnect", orphaned);
}).catch(error => {
  console.error("[beebot-host] startup failed:", error);
  process.exitCode = 1;
});
