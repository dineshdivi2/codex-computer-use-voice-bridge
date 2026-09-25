import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonValue } from "../schemas/typescript/serde_json/JsonValue.ts";

export interface HumanInterventionMcpOptions {
  nodeBinary?: string;
  serverScript?: string;
}

export function humanInterventionMcpConfig(
  options: HumanInterventionMcpOptions = {},
): { [key: string]: JsonValue } {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const nodeBinary = resolve(options.nodeBinary ?? process.execPath);
  const serverScript = resolve(
    options.serverScript ?? resolve(projectRoot, "src", "mcp-human-intervention-server.ts"),
  );
  return {
    mcp_servers: {
      human_intervention: {
        command: nodeBinary,
        args: ["--experimental-strip-types", serverScript],
        cwd: projectRoot,
        enabled: true,
        required: true,
        startup_timeout_sec: 20,
        tool_timeout_sec: 180,
        enabled_tools: ["request_human_intervention"],
        default_tools_approval_mode: "approve",
      },
    },
  };
}
