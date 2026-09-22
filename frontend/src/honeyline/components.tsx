import * as React from "react";
import { createPresenceCharacter } from "../presence/character";
import { createHoneylineWorkStatus } from "./packaged-ui";
export const PresenceCharacter = createPresenceCharacter(React);
export const PresenceWorkStatus = createHoneylineWorkStatus(React);
/** Stable aliases for older compiled adapters. */
export const HoneylineCharacter = PresenceCharacter;
export const HoneylineWorkStatus = PresenceWorkStatus;
