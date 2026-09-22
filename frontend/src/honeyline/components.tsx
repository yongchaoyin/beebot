import * as React from "react";
import { createHoneylineCharacter } from "./character";
import { createHoneylineWorkStatus } from "./packaged-ui";
export const HoneylineCharacter = createHoneylineCharacter(React);
export const HoneylineWorkStatus = createHoneylineWorkStatus(React);
