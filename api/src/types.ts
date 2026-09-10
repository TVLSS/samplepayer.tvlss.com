// Shared shapes for demo agents. Each agent is a system prompt plus a set of
// tools that read (or pretend to write) a synthetic back-office system.

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolResult = object;

export interface Tool {
  name: string;
  description: string;
  /** Which back-office system this tool reads. Shown in the ledger. */
  system: string;
  /** "read" tools are safe; "write" tools must be confirmed with the user first. */
  kind: "read" | "write";
  input_schema: JsonSchema;
  run: (input: Record<string, unknown>) => ToolResult;
}

export interface AgentDef {
  id: string;
  title: string;
  /** Who the demo user is signed in as. Inserted into the system prompt. */
  persona: string;
  system: string;
  tools: Tool[];
}
