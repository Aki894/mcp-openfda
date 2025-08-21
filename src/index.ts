import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const OPENFDA_BASE = "https://api.fda.gov/drug/label.json";
const API_KEY = process.env.OPENFDA_API_KEY;

interface FetchParams { [key: string]: string | number | undefined }

function buildUrl(params: FetchParams): string {
  const url = new URL(OPENFDA_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  if (API_KEY) url.searchParams.set("api_key", API_KEY);
  return url.toString();
}

async function fetchOpenFda(params: FetchParams) {
  const url = buildUrl(params);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`openFDA error: ${res.status} ${res.statusText} - ${text}`);
  }
  return res.json();
}

async function main() {
  const server = new McpServer(
    { name: "mcp-openfda-drug-label", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  // Define schemas and types to avoid implicit any
  const searchSchema = z.object({
    query: z
      .string()
      .describe('openFDA search query, e.g., "openfda.brand_name:ibuprofen"'),
    limit: z.number().int().min(1).max(100).optional().default(10),
    skip: z.number().int().min(0).optional().default(0),
    fields: z.string().optional().describe("Comma-separated fields to return"),
    sort: z.string().optional().describe("Sort expression, e.g., 'effective_time:desc'"),
  });
  type SearchInput = z.infer<typeof searchSchema>;

  const setIdSchema = z.object({ set_id: z.string().min(1) });
  type SetIdInput = z.infer<typeof setIdSchema>;

  const ndcSchema = z.object({
    ndc: z.string().min(1).describe("NDC product or package code"),
    limit: z.number().int().min(1).max(100).optional().default(10),
    skip: z.number().int().min(0).optional().default(0),
  });
  type NdcInput = z.infer<typeof ndcSchema>;

  const nameSchema = z.object({
    name: z.string().min(1).describe("Brand or generic name"),
    limit: z.number().int().min(1).max(100).optional().default(10),
    skip: z.number().int().min(0).optional().default(0),
  });
  type NameInput = z.infer<typeof nameSchema>;

  // General search
  server.tool(
    {
      name: "search_labels",
      description:
        "Search openFDA drug labels using an arbitrary query syntax. See https://open.fda.gov/apis/drug/label/ for query grammar.",
      inputSchema: searchSchema,
    },
    async (input: SearchInput) => {
      const { query, limit = 10, skip = 0, fields, sort } = input;
      const data = await fetchOpenFda({
        search: query,
        limit,
        skip,
        ...(fields ? { fields } : {}),
        ...(sort ? { sort } : {}),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // By set_id
  server.tool(
    {
      name: "get_label_by_set_id",
      description: "Get a specific label document by set_id.",
      inputSchema: setIdSchema,
    },
    async ({ set_id }: SetIdInput) => {
      const data = await fetchOpenFda({ search: `set_id:${set_id}`, limit: 1 });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // By NDC (product or package)
  server.tool(
    {
      name: "get_label_by_ndc",
      description: "Get labels by NDC (product or package).",
      inputSchema: ndcSchema,
    },
    async ({ ndc, limit = 10, skip = 0 }: NdcInput) => {
      const q = `(openfda.package_ndc:"${ndc}")+(openfda.product_ndc:"${ndc}")`;
      const data = await fetchOpenFda({ search: q, limit, skip });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // By drug name (brand or generic)
  server.tool(
    {
      name: "get_label_by_drug_name",
      description: "Get labels matching a brand or generic name.",
      inputSchema: nameSchema,
    },
    async ({ name, limit = 10, skip = 0 }: NameInput) => {
      const escaped = name.replace(/"/g, '\\"');
      const q = `(openfda.brand_name:"${escaped}")+(openfda.generic_name:"${escaped}")`;
      const data = await fetchOpenFda({ search: q, limit, skip });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Health check
  server.tool(
    { name: "health", description: "Check connectivity with openFDA.", inputSchema: z.object({}) },
    async () => {
      try {
        await fetchOpenFda({ limit: 1 });
        return { content: [{ type: "text", text: "ok" }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `error: ${e.message}` }] };
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
