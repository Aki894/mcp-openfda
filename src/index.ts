import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
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
  const server = new Server(
    { name: "mcp-openfda-drug-label", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  // General search
  server.tool(
    {
      name: "search_labels",
      description:
        "Search openFDA drug labels using an arbitrary query syntax. See https://open.fda.gov/apis/drug/label/ for query grammar.",
      inputSchema: z.object({
        query: z
          .string()
          .describe('openFDA search query, e.g., "openfda.brand_name:ibuprofen"'),
        limit: z.number().int().min(1).max(100).optional().default(10),
        skip: z.number().int().min(0).optional().default(0),
        fields: z.string().optional().describe("Comma-separated fields to return"),
        sort: z.string().optional().describe("Sort expression, e.g., 'effective_time:desc'"),
      }),
    },
    async (input) => {
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
      inputSchema: z.object({ set_id: z.string().min(1) }),
    },
    async ({ set_id }) => {
      const data = await fetchOpenFda({ search: `set_id:${set_id}`, limit: 1 });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // By NDC (product or package)
  server.tool(
    {
      name: "get_label_by_ndc",
      description: "Get labels by NDC (product or package).",
      inputSchema: z.object({
        ndc: z.string().min(1).describe("NDC product or package code"),
        limit: z.number().int().min(1).max(100).optional().default(10),
        skip: z.number().int().min(0).optional().default(0),
      }),
    },
    async ({ ndc, limit = 10, skip = 0 }) => {
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
      inputSchema: z.object({
        name: z.string().min(1).describe("Brand or generic name"),
        limit: z.number().int().min(1).max(100).optional().default(10),
        skip: z.number().int().min(0).optional().default(0),
      }),
    },
    async ({ name, limit = 10, skip = 0 }) => {
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
