import * as React from "react";
import { createPresenceCharacter } from "./character";
import { createPresenceWorkStatus, createPresenceMotionSetting } from "./packaged-ui";
export const PresenceCharacter = createPresenceCharacter(React);
export const PresenceWorkStatus = createPresenceWorkStatus(React);
export const PresenceMotionSetting = createPresenceMotionSetting(React);
