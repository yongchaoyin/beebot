import { fetchNodeJson, normalizeNodeUrl } from "./transport.js";

/** Unauthenticated discovery only. A node ID/name is not a TLS trust anchor.
 * Endpoints are the fixed BeeBot v1 profile, never server-selected navigation. */
export interface DiscoveredNode {
  baseUrl: string;
  nodeId: string;
  name: string;
  protocolVersion: 1;
}
export interface NodeConnectionPreview extends DiscoveredNode {
  previewId: string;
  checkedAt: number;
  expiresAt: number;
}
const label = (value: unknown, max: number): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= max && !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value);
const includes = (value: unknown, item: string) => Array.isArray(value) && value.includes(item);

export function validateNodeDiscovery(baseUrl: string, node: any, metadata: any): DiscoveredNode {
  if (normalizeNodeUrl(baseUrl) !== baseUrl) throw new Error("Use a canonical server origin.");
  if (node?.protocolVersion !== 1 || !label(node.id, 100) || !label(node.name, 100) || node.nodeId !== undefined && node.nodeId !== node.id) {
    throw new Error("This server does not support BeeBot protocol version 1 or returned an invalid identity.");
  }
  if (node.security?.dpopRequired !== true || node.security?.trustedDevicesRequired !== true) {
    throw new Error("Update this BeeBot Node: device-bound authentication and trusted-device approval are required.");
  }
  if (metadata?.issuer !== baseUrl || metadata.authorization_endpoint !== `${baseUrl}/oauth/authorize` ||
      metadata.token_endpoint !== `${baseUrl}/oauth/token` || metadata.revocation_endpoint !== `${baseUrl}/oauth/revoke`) {
    throw new Error("The authorization server identity or endpoints do not match this BeeBot server.");
  }
  if (!includes(metadata.response_types_supported, "code") || !includes(metadata.grant_types_supported, "authorization_code") ||
      !includes(metadata.grant_types_supported, "refresh_token") || !includes(metadata.code_challenge_methods_supported, "S256") ||
      !includes(metadata.token_endpoint_auth_methods_supported, "none") || !includes(metadata.dpop_signing_alg_values_supported, "ES256") ||
      metadata.authorization_response_iss_parameter_supported !== true || metadata.beebot_dpop_required !== true || metadata.beebot_trusted_devices_required !== true) {
    throw new Error("Update this BeeBot Node: the required secure browser sign-in profile is not supported.");
  }
  return { baseUrl, nodeId: node.id, name: node.name, protocolVersion: 1 };
}

export async function discoverNode(address: string, cancellation?: AbortSignal): Promise<DiscoveredNode> {
  // Caller cancellation must not remove the shared deadline for both documents.
  const deadline = AbortSignal.timeout(15_000);
  const signal = cancellation ? AbortSignal.any([cancellation, deadline]) : deadline;
  const baseUrl = normalizeNodeUrl(address);
  // Small independent public documents; no cookies, device proof or credentials.
  const node = await fetchNodeJson(baseUrl, "/v1/node", { signal, credentials: "omit" }, 64 * 1024);
  const metadata = await fetchNodeJson(baseUrl, "/.well-known/oauth-authorization-server", { signal, credentials: "omit" }, 64 * 1024);
  return validateNodeDiscovery(baseUrl, node, metadata);
}
