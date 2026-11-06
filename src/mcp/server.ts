import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ResolvedConfig } from "../core/config.js";
import { getPackageVersion } from "../core/version.js";
import { log } from "../util/logger.js";
import {
  handleFindJoinPath,
  handleSchemaChanges,
  handleSchemaOverview,
  handleTableDetails,
} from "./tools.js";

export const MCP_TOOLS = [
  {
    name: "schema_overview",
    description:
      "Compact database schema overview (tables, columns count, row estimates, FK links), hash, and age.",
    inputSchema: {
      type: "object",
      properties: {
        schemas: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of schemas to filter by.",
        },
        offset: {
          type: "integer",
          description: "Offset index of tables to display (for pagination).",
        },
        limit: {
          type: "integer",
          description: "Maximum number of tables to return.",
        },
        refresh: {
          type: "boolean",
          description: "Force fresh introspection bypassing cache.",
        },
      },
    },
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: "table_details",
    description:
      "Compact column details, keys, indexes, checks, and direct foreign key neighbors for up to 20 tables.",
    inputSchema: {
      type: "object",
      properties: {
        tables: {
          type: "array",
          items: { type: "string" },
          description: "Array of 1 to 20 table names to inspect (supports schema.table).",
        },
        refresh: {
          type: "boolean",
          description: "Force fresh introspection bypassing cache.",
        },
      },
      required: ["tables"],
    },
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: "find_join_path",
    description: "Find shortest join path between two tables across foreign keys.",
    inputSchema: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "Source table name.",
        },
        to: {
          type: "string",
          description: "Target table name.",
        },
        maxHops: {
          type: "integer",
          description: "Maximum join hops to search (default: 4).",
        },
      },
      required: ["from", "to"],
    },
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: "schema_changes",
    description: "Diff changes between current and previous schema snapshot.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    annotations: {
      readOnlyHint: true,
    },
  },
];

export function createMcpServer(config: ResolvedConfig): Server {
  const server = new Server(
    {
      name: "schema-lens",
      version: getPackageVersion(),
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: MCP_TOOLS,
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;

    let result = { content: "", isError: false };

    switch (name) {
      case "schema_overview":
        result = await handleSchemaOverview(rawArgs, config);
        break;
      case "table_details":
        result = await handleTableDetails(rawArgs, config);
        break;
      case "find_join_path":
        result = await handleFindJoinPath(rawArgs, config);
        break;
      case "schema_changes":
        result = await handleSchemaChanges(rawArgs, config);
        break;
      default:
        return {
          content: [
            {
              type: "text",
              text: `Unknown tool: "${name}"`,
            },
          ],
          isError: true,
        };
    }

    return {
      content: [
        {
          type: "text",
          text: result.content,
        },
      ],
      isError: result.isError,
    };
  });

  return server;
}

export async function startMcpServer(
  config: ResolvedConfig,
  customTransport?: Transport,
): Promise<Server> {
  const server = createMcpServer(config);
  const transport = customTransport ?? new StdioServerTransport();

  log("Starting schema-lens MCP server over stdio...");
  await server.connect(transport);
  log("Schema-lens MCP server connected.");

  return server;
}
