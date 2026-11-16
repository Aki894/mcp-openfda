# OpenFDA Drug Label MCP Server

Search FDA drug labels, retrieve safety and indication sections, fetch complete labels, and aggregate search results from an AI assistant.

[简体中文](README.md) · [API](https://open.fda.gov/apis/drug/label/) · [GitHub Issues](https://github.com/Aki894/mcp-openfda/issues)

## Features

- **`search_drug_labels`**: Search complete FDA drug labels with query expressions, pagination, or field-count aggregation. Returns full records or term/count buckets and upstream metadata.
- **`get_drug_adverse_reactions`**: Get untruncated adverse reactions and contraindications from matching drug labels, with label identifiers.
- **`get_drug_warnings`**: Get untruncated warnings, precautions, and boxed warnings from matching drug labels.
- **`get_drug_indications`**: Get untruncated indications, usage, and dosage sections from matching drug labels.
- **`get_drug_details`**: Get a complete, untruncated label by set_id, or selected top-level fields. Returns the most recent effective_time record in that label set.
- **`search_labels`**: Search labels by drug and optional adverse reaction; returns source records with safety section text.

## Quick start

Requires Git, Node.js 22 or later, npm, and access to `api.fda.gov`.

```bash
git clone https://github.com/Aki894/mcp-openfda.git
cd mcp-openfda
npm ci
npm run build
```

### Configure your MCP client

Add this entry to a client supporting the `mcpServers` format, replacing the entry point with its **absolute path**:

```json
{
  "mcpServers": {
    "openfda": {
      "command": "node",
      "args": [
        "/absolute/path/to/mcp-openfda/dist/index.js"
      ]
    }
  }
}
```

On Windows, use `D:/mcp/mcp-openfda/dist/index.js` to avoid JSON backslash escaping. If the client cannot find `node`, use the absolute path of the Node.js executable. Reload the MCP connection and inspect its tool list. For other client formats, enter the same command and arguments in their MCP settings.

The server uses **stdio** and is launched by the MCP client. No port or HTTP address is needed. Waiting for standard input when launched directly is expected.

### Optional API key

You can try the API without a key. For regular use, obtain an [openFDA API key](https://open.fda.gov/apis/authentication/) and add this to the server entry:

```json
{"env": {"OPENFDA_API_KEY": "YOUR_OPENFDA_API_KEY"}}
```

This is an additional field in the server entry, not a standalone client configuration. The key is sent through HTTP Basic Authentication and excluded from returned query URLs. Refer to the official documentation for quotas.

## Available tools

The server exposes **6 tools**. Validation rejects undeclared fields. Strings are trimmed and reject control characters. Pass numbers as JSON numbers and booleans as JSON booleans. Defaults, required fields, and bounds below match the server's published schemas.

### `search_drug_labels`

Search complete FDA drug labels with query expressions, pagination, or field-count aggregation. Returns full records or term/count buckets and upstream metadata.

| Parameter | Type | Required | Default | Description and bounds |
| --- | --- | --- | --- | --- |
| `search` | string | No | `—` | OpenFDA search expression, e.g. openfda.brand_name:aspirin length: 1–4000 characters |
| `count` | string | No | `—` | Aggregation field, e.g. openfda.manufacturer_name.exact length: 1–200 characters |
| `skip` | integer | No | `0` | Pagination offset; use 0 for count queries ≥0; ≤25000 |
| `limit` | integer | No | `10` | Maximum records or count buckets, 1–1000 ≥1; ≤1000 |

Example invocation (parameters for MCP `tools/call`):

```json
{
  "name": "search_drug_labels",
  "arguments": {
    "search": "openfda.generic_name:aspirin",
    "limit": 3
  }
}
```

### `get_drug_adverse_reactions`

Get untruncated adverse reactions and contraindications from matching drug labels, with label identifiers.

| Parameter | Type | Required | Default | Description and bounds |
| --- | --- | --- | --- | --- |
| `drug_name` | string | Yes | `—` | English generic, brand, or substance name length: 1–200 characters |
| `limit` | integer | No | `3` | Maximum label records, 1–50 ≥1; ≤50 |

Example invocation (parameters for MCP `tools/call`):

```json
{
  "name": "get_drug_adverse_reactions",
  "arguments": {
    "drug_name": "ibuprofen",
    "limit": 3
  }
}
```

### `get_drug_warnings`

Get untruncated warnings, precautions, and boxed warnings from matching drug labels.

| Parameter | Type | Required | Default | Description and bounds |
| --- | --- | --- | --- | --- |
| `drug_name` | string | Yes | `—` | English generic, brand, or substance name length: 1–200 characters |
| `limit` | integer | No | `3` | Maximum label records, 1–50 ≥1; ≤50 |

Example invocation (parameters for MCP `tools/call`):

```json
{
  "name": "get_drug_warnings",
  "arguments": {
    "drug_name": "ibuprofen",
    "limit": 3
  }
}
```

### `get_drug_indications`

Get untruncated indications, usage, and dosage sections from matching drug labels.

| Parameter | Type | Required | Default | Description and bounds |
| --- | --- | --- | --- | --- |
| `drug_name` | string | Yes | `—` | English generic, brand, or substance name length: 1–200 characters |
| `limit` | integer | No | `3` | Maximum label records, 1–50 ≥1; ≤50 |

Example invocation (parameters for MCP `tools/call`):

```json
{
  "name": "get_drug_indications",
  "arguments": {
    "drug_name": "aspirin",
    "limit": 3
  }
}
```

### `get_drug_details`

Get a complete, untruncated label by set_id, or selected top-level fields. Returns the most recent effective_time record in that label set.

| Parameter | Type | Required | Default | Description and bounds |
| --- | --- | --- | --- | --- |
| `set_id` | string | Yes | `—` | Label set_id in UUID format, obtained from search results |
| `fields` | string[] | No | `—` | Top-level label fields to return; omitted or empty returns the complete label maxItems=50 |

Example invocation (parameters for MCP `tools/call`):

```json
{
  "name": "get_drug_details",
  "arguments": {
    "set_id": "0058175f-3474-40c3-a046-6cfaec86d84b",
    "fields": [
      "indications_and_usage",
      "warnings"
    ]
  }
}
```

### `search_labels`

Search labels by drug and optional adverse reaction; returns source records with safety section text.

| Parameter | Type | Required | Default | Description and bounds |
| --- | --- | --- | --- | --- |
| `drug` | string | Yes | `—` | English generic or brand name length: 1–200 characters |
| `adr` | string | No | `—` | Optional adverse_reactions search text length: 1–200 characters |
| `limit` | integer | No | `5` | Maximum labels, 1–20 ≥1; ≤20 |

Example invocation (parameters for MCP `tools/call`):

```json
{
  "name": "search_labels",
  "arguments": {
    "drug": "ibuprofen",
    "adr": "bleeding",
    "limit": 3
  }
}
```

## Returned data and query behavior

The MCP response contains one `content` item with `type: "text"`; its `text` is a JSON string. Every successful result includes `source` and `query_url` identifying its source and primary request. Composite tools preserve additional request URLs in the result.

| Tool | Data fields and behavior |
| --- | --- |
| `search_drug_labels` | Upstream `meta`; complete label objects in `results`, with `url` added. With `count`, `results` contains `term` / `count` buckets rather than label records. |
| Three section tools | `meta` and `results`; each record preserves `id`, `set_id`, `version`, `effective_time`, `openfda`, `url`, and available requested sections without truncation. |
| `get_drug_details` | `set_id` and `drug_details`; complete label by default, or selected fields plus identity fields and source URL. `drug_details` is `null` when not found. |
| `search_labels` | `records[].id/url/content/metadata`; `content` contains named boxed-warning, warning, adverse-reaction, and interaction sections. Metadata includes `set_id` and `effective_time`. |

Search and section tools return empty arrays for no matches. Missing sections are omitted. Label counts are not distinct medicine counts: manufacturers and versions can differ. For regular searches, upstream `meta.results` includes `total`, `skip`, and `limit`; aggregation metadata follows the upstream format.

`drug_name` searches generic, brand, or substance names. `search_labels.drug` searches generic or brand names; `adr` filters only `adverse_reactions`. Name values are quoted, replacing embedded double quotes and backslashes with spaces. `search_drug_labels.search` accepts openFDA query syntax directly. A nonzero `skip` cannot be combined with `count`. Omitted or empty `fields` returns the complete label; absent requested fields are skipped.

## Usage examples

After connecting, ask your assistant:

> Find ibuprofen warnings and adverse reactions with source links, then retrieve a complete label using a returned set_id.

Use the returned data for retrieval and research. Clinical interpretation requires product, study-design, and patient context; this project does not provide individual medical advice.

## Data source

Each call uses the official `GET https://api.fda.gov/drug/label.json`. This project retrieves drug labels, not FAERS individual case reports. There is no local label database or result cache. See the [field reference](https://open.fda.gov/apis/drug/label/searchable-fields/) and [openFDA terms](https://open.fda.gov/terms/).

## Errors and troubleshooting

Tool failures set `isError: true`, with text JSON in this format:

```json
{"error":{"code":"invalid_arguments","message":"…","retryable":false}}
```

Each upstream request has a 30-second timeout and no automatic retries. Composite tools may make multiple requests. `retryable` indicates whether retrying later is appropriate.

| Symptom / code | Action |
| --- | --- |
| Missing tools or closed connection | Check Node.js ≥22, build the project, verify the absolute entry point, and reload the client. |
| `invalid_arguments` | Check required fields, types, bounds, enums, and extra parameters. |
| `unknown_tool` | Reload the tool list and use a name listed above. |
| `network / timeout` | Check access to api.fda.gov and retry later. |
| `http_429 / http_5xx` | Reduce request frequency and retry after recovery. |
| `http_400 / http_401 / http_403` | Check query syntax, credentials, and upstream access requirements. |
| `http_404` | Check the identifier; unmatched searches follow each tool’s empty-result behavior. |
| `invalid_json / invalid_response` | Unexpected upstream data; report persistent failures with the code. |
| `cancelled` | The client cancelled the request; invoke again if needed. |
| `internal / configuration` | Check the installation and local modifications; report runtime details and the error. |

## Run from source

```bash
npm run build
npm start
npm run dev
```

These commands build the project, run the build, and run TypeScript source directly.

## Support and license

Report problems through [GitHub Issues](https://github.com/Aki894/mcp-openfda/issues), including the Node.js version, MCP client, tool arguments, and error code. Remove credentials and personal information.

Code is licensed under [GPL-3.0](LICENSE). Source data terms apply separately.
