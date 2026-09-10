import type { AgentDef } from "../types.js";
import { benefits } from "./benefits.js";
import { claimsAgent } from "./claims.js";
import { membership } from "./membership.js";
import { groupAgent } from "./group.js";
import { accumulationsAgent } from "./accumulations.js";
import { healthServices } from "./health.js";
import { providerNetwork } from "./providers.js";

export const agents: Record<string, AgentDef> = Object.fromEntries(
  [benefits, claimsAgent, membership, groupAgent, accumulationsAgent, healthServices, providerNetwork].map((a) => [a.id, a]),
);
