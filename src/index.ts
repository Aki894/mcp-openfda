#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

interface DrugLabelSearchParams {
  search?: string;
  count?: string;
  skip?: number;
  limit?: number;
}

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
                maximum: 1000
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
                maximum: 100
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
                maximum: 100
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
                maximum: 100
              }
            },
            required: ["drug_name"]
          }
        }
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "search_drug_labels":
            return await this.searchDrugLabels(args as DrugLabelSearchParams);
          
          case "get_drug_adverse_reactions":
            return await this.getDrugAdverseReactions(args.drug_name, args.limit || 5);
          
          case "get_drug_warnings":
            return await this.getDrugWarnings(args.drug_name, args.limit || 5);
          
          case "get_drug_indications":
            return await this.getDrugIndications(args.drug_name, args.limit || 5);
          
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
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            meta: data.meta,
            results_count: data.results?.length || 0,
            results: data.results || []
          }, null, 2)
        }
      ]
    };
  }

  private async getDrugAdverseReactions(drugName: string, limit: number) {
    const searchQuery = `openfda.brand_name:"${drugName}" OR openfda.generic_name:"${drugName}" OR openfda.substance_name:"${drugName}"`;
    
    const data = await this.makeRequest({
      search: searchQuery,
      limit: limit
    });

    const adverseReactions = data.results?.map(result => ({
      drug_name: result.openfda?.brand_name?.[0] || result.openfda?.generic_name?.[0] || "Unknown",
      manufacturer: result.openfda?.manufacturer_name?.[0] || "Unknown",
      adverse_reactions: result.adverse_reactions || [],
      contraindications: result.contraindications || []
    })) || [];

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            query: drugName,
            total_results: data.meta?.results?.total || 0,
            adverse_reactions_data: adverseReactions
          }, null, 2)
        }
      ]
    };
  }

  private async getDrugWarnings(drugName: string, limit: number) {
    const searchQuery = `openfda.brand_name:"${drugName}" OR openfda.generic_name:"${drugName}" OR openfda.substance_name:"${drugName}"`;
    
    const data = await this.makeRequest({
      search: searchQuery,
      limit: limit
    });

    const warnings = data.results?.map(result => ({
      drug_name: result.openfda?.brand_name?.[0] || result.openfda?.generic_name?.[0] || "Unknown",
      manufacturer: result.openfda?.manufacturer_name?.[0] || "Unknown",
      warnings: result.warnings || [],
      precautions: result.precautions || [],
      boxed_warning: result.boxed_warning || []
    })) || [];

    return {
      content: [
        {
          type: "text", 
          text: JSON.stringify({
            query: drugName,
            total_results: data.meta?.results?.total || 0,
            warnings_data: warnings
          }, null, 2)
        }
      ]
    };
  }

  private async getDrugIndications(drugName: string, limit: number) {
    const searchQuery = `openfda.brand_name:"${drugName}" OR openfda.generic_name:"${drugName}" OR openfda.substance_name:"${drugName}"`;
    
    const data = await this.makeRequest({
      search: searchQuery,
      limit: limit
    });

    const indications = data.results?.map(result => ({
      drug_name: result.openfda?.brand_name?.[0] || result.openfda?.generic_name?.[0] || "Unknown",
      manufacturer: result.openfda?.manufacturer_name?.[0] || "Unknown", 
      indications_and_usage: result.indications_and_usage || [],
      dosage_and_administration: result.dosage_and_administration || []
    })) || [];

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            query: drugName,
            total_results: data.meta?.results?.total || 0,
            indications_data: indications
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
