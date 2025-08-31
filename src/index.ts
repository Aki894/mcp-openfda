#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const DrugLabelSearchParamsSchema = z.object({
  search: z.string().optional(),
  count: z.string().optional(),
  // accept number-like strings for pagination
  skip: z.coerce.number().int().min(0).optional().default(0),
  // OpenFDA allows up to 1000
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

type DrugLabelSearchParams = z.infer<typeof DrugLabelSearchParamsSchema>;

const DrugQueryParamsSchema = z.object({
  drug_name: z.string(),
  // accept number-like strings, default to 5 items
  limit: z.coerce.number().int().min(1).max(5).optional().default(3),
});

const DrugDetailParamsSchema = z.object({
  set_id: z.string(),
  fields: z.array(z.string()).optional(),
});

type DrugQueryParams = z.infer<typeof DrugQueryParamsSchema>;

interface OpenFDAResponse {
  meta: {
    disclaimer: string;
    terms: string;
    license: string;
    last_updated: string;
    results: {
      skip: number;
      limit: number;
      total: number;
    };
  };
  results: any[];
}

class OpenFDAServer {
  private server: Server;
  private baseUrl = "https://api.fda.gov/drug/label.json";

  constructor() {
    this.server = new Server(
      {
        name: "openfda-drug-label",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "search_drug_labels",
          description: "Search FDA drug labels using OpenFDA API. Returns drug labeling information including indications, contraindications, warnings, and adverse reactions.",
          inputSchema: {
            type: "object",
            properties: {
              search: {
                type: "string",
                description: "Search query. Can search by drug name, active ingredient, manufacturer, etc. Example: 'aspirin', 'ibuprofen', 'openfda.brand_name:tylenol'"
              },
              count: {
                type: "string", 
                description: "Field to count results by. Example: 'openfda.manufacturer_name.exact'"
              },
              skip: {
                type: "number",
                description: "Number of records to skip (for pagination)",
                default: 0
              },
              limit: {
                type: "number", 
                description: "Maximum number of records to return (1-1000)",
                default: 10,
                minimum: 1,
                maximum: 100
              }
            }
          }
        },
        {
          name: "get_drug_adverse_reactions",
          description: "Get adverse reactions information for a specific drug from FDA labels",
          inputSchema: {
            type: "object",
            properties: {
              drug_name: {
                type: "string",
                description: "Name of the drug to search for adverse reactions"
              },
              limit: {
                type: "number",
                description: "Maximum number of records to return",
                default: 5,
                minimum: 1,
                maximum: 10
              }
            },
            required: ["drug_name"]
          }
        },
        {
          name: "get_drug_warnings",
          description: "Get warnings and precautions for a specific drug from FDA labels",
          inputSchema: {
            type: "object",
            properties: {
              drug_name: {
                type: "string", 
                description: "Name of the drug to search for warnings"
              },
              limit: {
                type: "number",
                description: "Maximum number of records to return",
                default: 5,
                minimum: 1,
                maximum: 10
              }
            },
            required: ["drug_name"]
          }
        },
        {
          name: "get_drug_indications",
          description: "Get indications and usage information for a specific drug from FDA labels",
          inputSchema: {
            type: "object",
            properties: {
              drug_name: {
                type: "string",
                description: "Name of the drug to search for indications"
              },
              limit: {
                type: "number",
                description: "Maximum number of records to return", 
                default: 5,
                minimum: 1,
                maximum: 10
              }
            },
            required: ["drug_name"]
          }
        },
        {
          name: "get_drug_details",
          description: "Get complete detailed information for a specific drug using its set_id. Use this when you need full, untruncated information.",
          inputSchema: {
            type: "object",
            properties: {
              set_id: {
                type: "string",
                description: "The set_id of the drug label (obtained from other search results)"
              },
              fields: {
                type: "array",
                items: {
                  type: "string"
                },
                description: "Optional: Specific fields to return. If not provided, returns key fields only. Available fields: indications_and_usage, warnings, adverse_reactions, contraindications, dosage_and_administration, drug_interactions, boxed_warning, precautions",
                default: []
              }
            },
            required: ["set_id"]
          }
        }
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: rawArgs } = request.params;

      // Handle cases where arguments are double-encoded as a JSON string
      let args: any;
      if (typeof rawArgs === 'string') {
        try {
          args = JSON.parse(rawArgs);
        } catch (e) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Failed to parse arguments string: ' + (e as Error).message
          );
        }
      } else {
        args = rawArgs;
      }

      if (!args) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Missing arguments"
        );
      }

      try {
        switch (name) {
          case "search_drug_labels":
            const searchParams = DrugLabelSearchParamsSchema.parse(args);
            return await this.searchDrugLabels(searchParams);
          
          case "get_drug_adverse_reactions":
            const adverseParams = DrugQueryParamsSchema.parse(args);
            return await this.getDrugAdverseReactions(adverseParams.drug_name, adverseParams.limit || 5);
          
          case "get_drug_warnings":
            const warningParams = DrugQueryParamsSchema.parse(args);
            return await this.getDrugWarnings(warningParams.drug_name, warningParams.limit || 5);
          
          case "get_drug_indications":
            const indicationParams = DrugQueryParamsSchema.parse(args);
            return await this.getDrugIndications(indicationParams.drug_name, indicationParams.limit || 5);
          
          case "get_drug_details":
            const detailParams = DrugDetailParamsSchema.parse(args);
            return await this.getDrugDetails(detailParams.set_id, detailParams.fields);
          
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Error executing tool ${name}: ${error}`
        );
      }
    });
  }

  // Helper method to truncate long text
  private truncateText(text: string | string[], maxLength: number = 500): string {
    if (!text) return "";
    
    const textStr = Array.isArray(text) ? text.join(" ") : text;
    if (textStr.length <= maxLength) return textStr;
    
    return textStr.substring(0, maxLength) + "... [truncated]";
  }

  // Extract only key information from drug label data
  private extractKeyDrugInfo(result: any) {
    return {
      // Basic drug information
      brand_name: result.openfda?.brand_name?.[0] || "Unknown",
      generic_name: result.openfda?.generic_name?.[0] || "Unknown",
      manufacturer: result.openfda?.manufacturer_name?.[0] || "Unknown",
      
      // Key medical information (truncated)
      indications: this.truncateText(result.indications_and_usage, 300),
      warnings: this.truncateText(result.warnings, 300),
      adverse_reactions: this.truncateText(result.adverse_reactions, 300),
      contraindications: this.truncateText(result.contraindications, 200),
      
      // Dosage info (truncated)
      dosage: this.truncateText(result.dosage_and_administration, 200),
      
      // Additional key fields
      drug_interactions: this.truncateText(result.drug_interactions, 200),
      pregnancy_category: result.pregnancy?.[0] || null,
      
      // Metadata
      set_id: result.set_id,
      version: result.version
    };
  }

  private async makeRequest(params: DrugLabelSearchParams): Promise<OpenFDAResponse> {
    const url = new URL(this.baseUrl);
    
    if (params.search) {
      url.searchParams.set("search", params.search);
    }
    if (params.count) {
      url.searchParams.set("count", params.count);
    }
    if (params.skip) {
      url.searchParams.set("skip", params.skip.toString());
    }
    if (params.limit) {
      url.searchParams.set("limit", params.limit.toString());
    }

    const response = await fetch(url.toString());
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenFDA API error (${response.status}): ${errorText}`);
    }

    return await response.json();
  }

  private async searchDrugLabels(params: DrugLabelSearchParams) {
    const data = await this.makeRequest(params);
    
    // Extract and summarize key information only
    const summarizedResults = data.results?.map(result => this.extractKeyDrugInfo(result)) || [];
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            meta: {
              total_results: data.meta?.results?.total || 0,
              returned_count: summarizedResults.length,
              skip: data.meta?.results?.skip || 0,
              limit: data.meta?.results?.limit || 0
            },
            results: summarizedResults
          }, null, 2)
        }
      ]
    };
  }

  private async getDrugAdverseReactions(drugName: string, limit: number) {
    const searchQuery = `openfda.brand_name:"${drugName}" OR openfda.generic_name:"${drugName}" OR openfda.substance_name:"${drugName}"`;
    
    const data = await this.makeRequest({
      search: searchQuery,
      limit: limit,
      skip: 0
    });

    const adverseReactions = data.results?.map(result => ({
      drug_name: result.openfda?.brand_name?.[0] || result.openfda?.generic_name?.[0] || "Unknown",
      manufacturer: result.openfda?.manufacturer_name?.[0] || "Unknown",
      adverse_reactions: this.truncateText(result.adverse_reactions, 400),
      contraindications: this.truncateText(result.contraindications, 300),
      set_id: result.set_id // For getting full details later
    })) || [];

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            query: drugName,
            total_results: data.meta?.results?.total || 0,
            returned_count: adverseReactions.length,
            adverse_reactions_data: adverseReactions,
            note: "Text has been truncated for brevity. Use get_drug_details with set_id for full information."
          }, null, 2)
        }
      ]
    };
  }

  private async getDrugWarnings(drugName: string, limit: number) {
    const searchQuery = `openfda.brand_name:"${drugName}" OR openfda.generic_name:"${drugName}" OR openfda.substance_name:"${drugName}"`;
    
    const data = await this.makeRequest({
      search: searchQuery,
      limit: limit,
      skip: 0
    });

    const warnings = data.results?.map(result => ({
      drug_name: result.openfda?.brand_name?.[0] || result.openfda?.generic_name?.[0] || "Unknown",
      manufacturer: result.openfda?.manufacturer_name?.[0] || "Unknown",
      warnings: this.truncateText(result.warnings, 400),
      precautions: this.truncateText(result.precautions, 300),
      boxed_warning: this.truncateText(result.boxed_warning, 300),
      set_id: result.set_id
    })) || [];

    return {
      content: [
        {
          type: "text", 
          text: JSON.stringify({
            query: drugName,
            total_results: data.meta?.results?.total || 0,
            returned_count: warnings.length,
            warnings_data: warnings,
            note: "Text has been truncated for brevity. Use get_drug_details with set_id for full information."
          }, null, 2)
        }
      ]
    };
  }

  private async getDrugIndications(drugName: string, limit: number) {
    const searchQuery = `openfda.brand_name:"${drugName}" OR openfda.generic_name:"${drugName}" OR openfda.substance_name:"${drugName}"`;
    
    const data = await this.makeRequest({
      search: searchQuery,
      limit: limit,
      skip: 0
    });

    const indications = data.results?.map(result => ({
      drug_name: result.openfda?.brand_name?.[0] || result.openfda?.generic_name?.[0] || "Unknown",
      manufacturer: result.openfda?.manufacturer_name?.[0] || "Unknown", 
      indications_and_usage: this.truncateText(result.indications_and_usage, 400),
      dosage_and_administration: this.truncateText(result.dosage_and_administration, 300),
      set_id: result.set_id
    })) || [];

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            query: drugName,
            total_results: data.meta?.results?.total || 0,
            returned_count: indications.length,
            indications_data: indications,
            note: "Text has been truncated for brevity. Use get_drug_details with set_id for full information."
          }, null, 2)
        }
      ]
    };
  }

  private async getDrugDetails(setId: string, fields?: string[]) {
    const data = await this.makeRequest({
      search: `set_id:"${setId}"`,
      limit: 1,
      skip: 0
    });

    if (!data.results || data.results.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "No drug found with the specified set_id",
              set_id: setId
            }, null, 2)
          }
        ]
      };
    }

    const result = data.results[0];
    let responseData: any = {};

    if (fields && fields.length > 0) {
      // Return only requested fields
      for (const field of fields) {
        if (result[field]) {
          responseData[field] = result[field];
        }
      }
    } else {
      // Return key fields with full content (no truncation)
      responseData = {
        drug_name: result.openfda?.brand_name?.[0] || result.openfda?.generic_name?.[0] || "Unknown",
        manufacturer: result.openfda?.manufacturer_name?.[0] || "Unknown",
        indications_and_usage: result.indications_and_usage || [],
        warnings: result.warnings || [],
        adverse_reactions: result.adverse_reactions || [],
        contraindications: result.contraindications || [],
        dosage_and_administration: result.dosage_and_administration || [],
        drug_interactions: result.drug_interactions || [],
        boxed_warning: result.boxed_warning || [],
        precautions: result.precautions || [],
        pregnancy: result.pregnancy || [],
        set_id: result.set_id,
        version: result.version
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            set_id: setId,
            drug_details: responseData,
            note: "This is the complete, untruncated information for this drug."
          }, null, 2)
        }
      ]
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("OpenFDA Drug Label MCP server running on stdio");
  }
}

const server = new OpenFDAServer();
server.run().catch(console.error);
