/** An upstream hosted-service denial is not a BeeBot subscription requirement.
 * Copy only: these records neither grant access nor select another runtime. */
export interface ExternalAccessCopy {
  readonly title: string;
  readonly body: string;
  readonly action: string | null;
}

export const CONNECTION_HELP_URL = "https://github.com/yongchaoyin/beebot#readme";
const action = "Connection Help";
const alternative = "You can configure your own model or an independently authorized server in Settings.";

export const EXTERNAL_ACCESS_BY_REASON: Readonly<Record<string, ExternalAccessCopy>> = {
  teamPrivacyMode: {
    title: "External service blocked by team policy",
    body: `The external provider's team policy blocks this hosted connection. Ask its administrator to review access. ${alternative}`,
    action,
  },
  teamSetupRequired: {
    title: "External service setup is incomplete",
    body: `A team administrator must finish setup with that provider before this hosted connection can be used. ${alternative}`,
    action,
  },
  teamAccessRequired: {
    title: "External service access is not granted",
    body: `This account has not been granted access to the provider's hosted service. ${alternative}`,
    action,
  },
  notOffered: {
    title: "External service is unavailable for this account",
    body: `The provider does not offer this hosted service to this account. ${alternative}`,
    action,
  },
  freeTrialAvailable: {
    title: "External service access is not active",
    body: `The provider reports an available trial, not active access. BeeBot does not require that trial. ${alternative}`,
    action,
  },
  paywallIndividual: {
    title: "External service requires a provider plan",
    body: `This restriction belongs to the provider's hosted service, not a BeeBot subscription. ${alternative}`,
    action,
  },
  paywallTeamMember: {
    title: "External service requires team authorization",
    body: `Ask the external service's administrator to review this account's seat and access. ${alternative}`,
    action,
  },
  paywallTeamAdmin: {
    title: "External service requires team authorization",
    body: `Review this account's seat and access with the external provider. ${alternative}`,
    action,
  },
};

export const EXTERNAL_ACCESS_BY_STATE: Readonly<Record<string, ExternalAccessCopy>> = {
  unavailable: { title: "External hosted service is unavailable", body: `This hosted connection is blocked by its provider. ${alternative}`, action },
  paymentRequired: { title: "External service requires provider authorization", body: `The provider reports a plan restriction for this connection, not for BeeBot itself. ${alternative}`, action },
};
export const EXTERNAL_ACCESS_UNKNOWN: ExternalAccessCopy = {
  title: "External service access is not confirmed",
  body: `Access to this hosted connection has not been confirmed. ${alternative}`,
  action,
};

export const EXTERNAL_SERVICE_MESSAGES = {
  privacyBlocked: "The external provider's team privacy policy blocks this hosted connection. Review the policy with its administrator. Local models and independently authorized servers do not require changing that provider setting.",
  trialEnded: "The external provider's hosted-service trial has ended. This restricts that connection, not BeeBot's local model or independently authorized server connections.",
  cancelTrial: "This cancels the external provider's hosted-service trial and its remaining trial credits. Review the provider's billing terms before confirming. This is not a BeeBot subscription.",
  usage: "Review usage with the external provider",
} as const;

/** Legacy hosted feedback failures stay failures, without advertising a BeeBot plan. */
export const EXTERNAL_FEEDBACK_MESSAGES = {
  "access-denied": "This account cannot use the external provider's feedback service. BeeBot feedback is available from Help.",
  "invalid-feedback": "Write between 1 and 10,000 characters.",
  "not-signed-in": "The external provider's feedback service requires its own account. BeeBot feedback is available from Help.",
  "rate-limited": "You've sent several reports. Try again in a few minutes.",
  "subscription-required": "The external provider restricts this feedback service. A BeeBot subscription is not required; use Help for BeeBot feedback.",
  unavailable: "We couldn't deliver this report. Try again."
} as const;
