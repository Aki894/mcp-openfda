# MCP Server: openFDA Drug Label

This MCP server exposes tools to query the openFDA Drug Label API for use by MCP-compatible AI agents.

Docs: https://open.fda.gov/apis/drug/label/

## Features

- search_labels: arbitrary query against `drug/label.json`
- get_label_by_set_id: fetch a label by `set_id`
- get_label_by_ndc: search by product or package NDC
- get_label_by_drug_name: search by brand or generic name
- Optional API key via `OPENFDA_API_KEY` to increase rate limits

## Prerequisites

- Node.js 18+ (for built-in `fetch`)

## Install

```bash
# In the project directory
npm install
npm run build
```

## Dev

```bash
npm run dev
```

## Configuration

Create `.env` (optional):

```env
OPENFDA_API_KEY=your_key_here
```

## Tools

- search_labels
  - input: { query: string, limit?: 1..100, skip?: 0.., fields?: string, sort?: string }
- get_label_by_set_id
  - input: { set_id: string }
- get_label_by_ndc
  - input: { ndc: string, limit?: 1..100, skip?: 0.. }
- get_label_by_drug_name
  - input: { name: string, limit?: 1..100, skip?: 0.. }
- health
  - input: {}

All tools return the raw openFDA JSON as text content.

## Example queries

- Brand name ibuprofen:
  - tool: `get_label_by_drug_name` with `{ "name": "ibuprofen", "limit": 3 }`
- Explicit query:
  - tool: `search_labels` with `{ "query": "openfda.route:ORAL", "limit": 5, "fields": "openfda.brand_name,set_id" }`

## Integrating with MCP clients

Example (OpenAI Desktop MCP config):

```json
{
  "mcpServers": {
    "openfda-labels": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "./mcp-openfda",
      "env": {
        "OPENFDA_API_KEY": "${OPENFDA_API_KEY}"
      }
    }
  }
}
```

Alternatively, for development you can run with ts-node:

```json
{
  "mcpServers": {
    "openfda-labels": {
      "command": "npx",
      "args": ["ts-node", "src/index.ts"],
      "cwd": "./mcp-openfda"
    }
  }
}
```

## Notes

- openFDA rate limits apply. Provide an API key for higher quota.
- Use the `fields` parameter to reduce payload size when needed.
