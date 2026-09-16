import { join } from "node:path";

import type { SandInferenceProvider } from "../../../shared/inference-router.js";
import type { InferenceVendorAccount } from "../../../shared/inference-vendor.js";
import { SandSettingsStore } from "../../../shared/node/settings/sand-settings-store.js";
import { getSandProfilePath, readSandProfileFile } from "../../agents/agent-profile.js";
import { getSandRootDir } from "../../host-paths.js";

export class MissingInferenceVendorError extends Error {
  readonly vendorId: string;
  constructor(vendorId: string) {
    super("This bot's model API is missing. Open Settings → Router → Model APIs and add it again.");
    this.name = "MissingInferenceVendorError";
    this.vendorId = vendorId;
  }
}

export interface ResolveInferenceDeps {
  getInferenceVendor(id?: string): InferenceVendorAccount | undefined;
  getInferenceProvider(): SandInferenceProvider;
  readProfile(agentId: string): { inferenceVendorId?: string } | null;
}

function productionDeps(): ResolveInferenceDeps {
  const settings = new SandSettingsStore(join(getSandRootDir(), "settings.json"));
  return {
    getInferenceVendor: (id) => settings.getInferenceVendor(id),
    getInferenceProvider: () => settings.getInferenceProvider(),
    readProfile: (agentId) => (
      readSandProfileFile(getSandProfilePath(join(getSandRootDir(), "agents", agentId)))
      ?? readSandProfileFile(getSandProfilePath(join(getSandRootDir(), agentId)))
    ),
  };
}

export function resolveInferenceForAgent(
  agentId?: string,
  deps: ResolveInferenceDeps = productionDeps(),
): { provider: SandInferenceProvider; vendor?: InferenceVendorAccount } {
  if (agentId != null && agentId.length > 0) {
    const vendorId = deps.readProfile(agentId)?.inferenceVendorId?.trim() ?? "";
    if (vendorId.length > 0) {
      const vendor = deps.getInferenceVendor(vendorId);
      if (vendor != null) return { provider: vendor.provider, vendor };
      throw new MissingInferenceVendorError(vendorId);
    }
  }
  const vendor = deps.getInferenceVendor(undefined);
  if (vendor != null) return { provider: vendor.provider, vendor };
  return { provider: deps.getInferenceProvider() };
}
