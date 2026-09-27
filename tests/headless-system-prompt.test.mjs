import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  stdin: { contents: `
    export * from './source/host/runner/system-prompt.ts';
    export { createSystemPromptAssembly } from './source/host/runner/system-prompt-assembly.ts';
    export { createPromptCollectorGlue } from './source/host/runner/prompt-collector-glue.ts';
  `, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' },
  bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node26', write: false, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', '__filename', '__dirname', outputFiles[0].text)(
  createRequire(import.meta.url), module, module.exports, fileURLToPath(import.meta.url), dirname(fileURLToPath(import.meta.url)),
);
const r = module.exports;
const guiPromises = /Your own computer also gives you a Linux desktop|The box has a desktop and browser|your read-only Screenshot tool|the box's signed-in browser|the box's desktop and GUI apps|box's browser share one filesystem|request_box_help|configured browser state survive turns/;

function fixture({ sharedRoom = false, override } = {}) {
  const state = { desktop: false, cloudDisabled: false };
  const glue = r.createPromptCollectorGlue({ get remoteBoxHasDesktop() { return state.desktop; } });
  const assembly = r.createSystemPromptAssembly({
    basePrompt: override ?? r.DEFAULT_SAND_SYSTEM_PROMPT,
    remoteBoxHasDesktop: () => state.desktop,
    isSubagentRunner: false, isSharedRoomRunner: sharedRoom, isSystemPromptOverridden: override !== undefined,
    agentProfileProvider: () => null, agentStore: () => null, compactionEpoch: () => 0,
    memoryStore: () => null, memorySnapshots: () => null, userMemory: () => null, projectMemory: () => null,
    isBoxScopedSubagent: () => false, requestContext: { resolve: () => ({ timeZone: 'UTC' }) },
    automationStore: () => null, workflowStore: () => null, channelStore: () => null,
    connectorManifests: [], isSpotlightEnabled: () => false, mcpManagement: () => null,
    isCloudAgentsDisabledByTeam: () => state.cloudDisabled,
    mcpCustomInstructionsSection: () => null, mcpDiscoveryStatusSection: () => null,
    remoteBoxSection: () => glue.getRemoteBoxSection(), computerSection: () => glue.getComputerSection(),
  });
  return { state, assembly };
}

test('actual assembled headless prompt has no GUI promises with cloud agents enabled or disabled', () => {
  for (const sharedRoom of [false, true]) {
    const { state, assembly } = fixture({ sharedRoom });
    for (const cloudDisabled of [false, true]) {
      state.cloudDisabled = cloudDisabled;
      const prompt = assembly.getSystemPrompt();
      assert.match(prompt, /headless Node workspace with Shell and Read/);
      assert.match(prompt, /no graphical desktop, browser session, Screenshot or Computer tool/);
      assert.doesNotMatch(prompt, guiPromises);
      assert.match(prompt, /only.*SendMessage|SendMessage is your only voice/);
      if (cloudDisabled) assert.match(prompt, /CloudAgent is unavailable in this session/);
    }
  }
});

test('assembled prompt follows live capability changes and preserves local desktop workflows', () => {
  const { state, assembly } = fixture();
  assert.doesNotMatch(assembly.getSystemPrompt(), guiPromises);
  state.desktop = true;
  const desktop = assembly.getSystemPrompt();
  assert.match(desktop, /Your own computer also gives you a Linux desktop/);
  assert.match(desktop, /your read-only Screenshot tool/);
  assert.match(desktop, /request_box_help/);
  assert.match(desktop, /box's browser share one filesystem/);
  state.desktop = false;
  assert.doesNotMatch(assembly.getSystemPrompt(), guiPromises);
});

test('explicit system prompt overrides retain their content while capability sections remain truthful', () => {
  const override = 'Keep this user-supplied quoted example: "The box has a desktop and browser".';
  const { state, assembly } = fixture({ override });
  state.cloudDisabled = true;
  const prompt = assembly.getSystemPrompt();
  assert.ok(prompt.startsWith(override));
  assert.match(prompt, /has no graphical desktop/);
  assert.match(prompt, /CloudAgent tool is unavailable/);
});
