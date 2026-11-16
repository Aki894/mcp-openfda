import {z} from "zod";
import {ApiError, getJson, type RequestOptions} from "./http.js";
import {array, catalog, invoke, object, quote, select, size, term, text, tool, type Row} from "./lib.js";

const query = z.object({
  search: text.optional().describe("OpenFDA search expression, e.g. openfda.brand_name:aspirin"),
  count: term.regex(/^[a-zA-Z0-9_.:]+$/).optional().describe("Aggregation field, e.g. openfda.manufacturer_name.exact"),
  skip: z.number().int().min(0).max(25000).default(0).describe("Pagination offset; use 0 for count queries"),
  limit: size(1000, 10).describe("Maximum records or count buckets, 1–1000"),
}).strict();
const drugQuery = z.object({
  drug_name: term.describe("English generic, brand, or substance name"),
  limit: size(50, 3).describe("Maximum label records, 1–50"),
}).strict();
const fields = z.array(term.regex(/^[a-zA-Z][a-zA-Z0-9_]*$/)).max(50).optional()
  .describe("Top-level label fields to return; omitted or empty returns the complete label");
const details = z.object({set_id: z.string().uuid().describe("Label set_id obtained from search results"), fields}).strict();
const alias = z.object({drug: term.describe("English generic or brand name"), adr: term.optional().describe("Optional adverse_reactions search text"), limit: size(20, 5).describe("Maximum labels, 1–20")}).strict();

const drugSearch = (name: string) => `(${["brand_name", "generic_name", "substance_name"].map(f => `openfda.${f}:${quote(name)}`).join(" OR ")})`;
async function request(params: Record<string, string | number | undefined>, options: RequestOptions) {
  const url = new URL("https://api.fda.gov/drug/label.json");
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, String(value));
  const key = process.env.OPENFDA_API_KEY;
  const authenticated = key ? {...options, headers: {...options.headers, Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`}} : options;
  try {
    const data = object(await getJson(url, authenticated));
    return {url: url.href, meta: object(data.meta), results: array(data.results).map(object)};
  } catch (error) {
    if (error instanceof ApiError && error.code === "http_404" && error.upstreamCode === "NOT_FOUND") {
      return {url: url.href, meta: {results: {total: 0, skip: Number(params.skip ?? 0), limit: Number(params.limit ?? 1)}}, results: [] as Row[]};
    }
    throw error;
  }
}
const identity = ["id", "set_id", "version", "effective_time", "openfda"];
const sectionTool = (name: string, description: string, sections: string[]) => tool(name, description, drugQuery, async (p, options) => {
  const data = await request({search: drugSearch(p.drug_name), limit: p.limit}, options);
  return {source: "fda_label", query_url: data.url, meta: data.meta,
    results: data.results.map(row => ({...select(row, [...identity, ...sections]),
      url: labelUrl(row)}))};
});
function labelUrl(row: Row): string {
  if (typeof row.id !== "string") throw new ApiError("invalid_response", "Missing FDA label ID");
  return `https://api.fda.gov/drug/label.json?search=${encodeURIComponent(`id:${quote(row.id)}`)}`;
}

export const specs = [
  tool("search_drug_labels", "Search complete FDA drug labels with query expressions, pagination, or field-count aggregation. Returns full records or term/count buckets and upstream metadata.", query, async (p, options) => {
    if (p.count && p.skip !== 0) throw new ApiError("invalid_arguments", "Count queries do not support skip; use skip=0");
    const data = await request({search: p.search, count: p.count, skip: p.count ? undefined : p.skip, limit: p.limit}, options);
    return {source: "fda_label", query_url: data.url, meta: data.meta,
      results: p.count ? data.results : data.results.map(row => ({...row, url: labelUrl(row)}))};
  }),
  sectionTool("get_drug_adverse_reactions", "Get untruncated adverse reactions and contraindications from matching drug labels, with label identifiers.", ["adverse_reactions", "contraindications"]),
  sectionTool("get_drug_warnings", "Get untruncated warnings, precautions, and boxed warnings from matching drug labels.", ["warnings", "warnings_and_cautions", "precautions", "boxed_warning"]),
  sectionTool("get_drug_indications", "Get untruncated indications, usage, and dosage sections from matching drug labels.", ["indications_and_usage", "dosage_and_administration"]),
  tool("get_drug_details", "Get a complete, untruncated label by set_id, or selected top-level fields. Returns the most recent effective_time record in that label set.", details, async (p, options) => {
    const data = await request({search: `set_id:${quote(p.set_id)}`, sort: "effective_time:desc", limit: 1}, options);
    return {source: "fda_label", query_url: data.url, set_id: p.set_id,
      drug_details: data.results.length ? {...(p.fields?.length ? select(data.results[0], [...identity, ...p.fields]) : data.results[0]), url: labelUrl(data.results[0])} : null};
  }),
  tool("search_labels", "ADR-Synthesizer compatible label search by drug and optional adverse reaction; returns source records with safety section text.", alias, async (p, options) => {
    let search = `(openfda.generic_name:${quote(p.drug)} OR openfda.brand_name:${quote(p.drug)})`;
    if (p.adr) search += ` AND adverse_reactions:${quote(p.adr)}`;
    const data = await request({search, limit: p.limit}, options);
    return {source: "fda_label", query_url: data.url, records: data.results.map(row => ({
      id: row.id, url: labelUrl(row),
      content: ["boxed_warning", "warnings", "adverse_reactions", "drug_interactions"].flatMap(section => {
        if (row[section] === undefined) return [];
        return array(row[section]).map(value => {
          if (typeof value !== "string") throw new ApiError("invalid_response", "Invalid label section");
          return `${section}: ${value}`;
        });
      }).join("\n"), metadata: {effective_time: row.effective_time ?? null, set_id: row.set_id ?? null},
    }))};
  }),
];
export const definitions = catalog(specs);
export const execute = (name: string, args: unknown, options: RequestOptions = {}) => invoke(specs, name, args, options);
