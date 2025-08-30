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
import {
  chunkText,
  rankAndPickTop,
  summarizeChunks,
  extractCitations,
  TextChunk,
  RAGResult
} from "./rag-utils.js";

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

type DrugQueryParams = z.infer<typeof DrugQueryParamsSchema>;

const AEPipelineRAGParamsSchema = z.object({
  query: z.string().optional(),
  drug: z.string().optional(),
  condition: z.string().optional(),
  top_k: z.coerce.number().int().min(1).max(10).optional().default(5),
  filters: z.object({
    limit: z.coerce.number().int().min(1).max(100).optional().default(50)
  }).optional().default({})
});

type AEPipelineRAGParams = z.infer<typeof AEPipelineRAGParamsSchema>;

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
          name: "ae_pipeline_rag",
          description: "Advanced RAG pipeline for drug safety analysis. Fetches, extracts, chunks, retrieves and summarizes FDA drug label data in one call to prevent LLM response truncation.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Natural language query about drug safety. Example: 'cardiovascular side effects and warnings'"
              },
              drug: {
                type: "string",
                description: "Drug name to focus the analysis on. Example: 'aspirin', 'ibuprofen'"
              },
              condition: {
                type: "string",
                description: "Medical condition context. Example: 'hypertension', 'pain management'"
              },
              top_k: {
                type: "number",
                description: "Number of most relevant text chunks to return (1-10)",
                default: 5,
                minimum: 1,
                maximum: 10
              },
              filters: {
                type: "object",
                description: "Additional filters for data retrieval",
                properties: {
                  limit: {
                    type: "number",
                    description: "Maximum drug labels to fetch",
                    default: 50,
                    minimum: 1,
                    maximum: 100
                  }
                }
              }
            }
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
          
          case "ae_pipeline_rag":
            const ragParams = AEPipelineRAGParamsSchema.parse(args);
            return await this.aePipelineRag(ragParams);
          
          case "get_drug_indications":
            const indicationParams = DrugQueryParamsSchema.parse(args);
            return await this.getDrugIndications(indicationParams.drug_name, indicationParams.limit || 5);
          
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
      limit: limit,
      skip: 0
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
      limit: limit,
      skip: 0
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
      limit: limit,
      skip: 0
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

  private async aePipelineRag(params: AEPipelineRAGParams): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      // 1. 构建搜索参数
      const searchParams: DrugLabelSearchParams = {
        limit: params.filters?.limit || 50,
        skip: 0
      };

      // 构建搜索查询
      const searchTerms = [];
      if (params.drug) {
        searchTerms.push(`openfda.brand_name:"${params.drug}" OR openfda.generic_name:"${params.drug}" OR openfda.substance_name:"${params.drug}"`);
      }
      if (params.condition) {
        searchTerms.push(`indications_and_usage:"${params.condition}"`);
      }
      if (params.query) {
        // 将查询词添加到搜索中
        const queryWords = params.query.split(/\s+/).filter(w => w.length > 2);
        if (queryWords.length > 0) {
          searchTerms.push(queryWords.join(' AND '));
        }
      }

      if (searchTerms.length > 0) {
        searchParams.search = searchTerms.join(' AND ');
      } else if (params.drug) {
        // 如果只有药物名，使用简单搜索
        searchParams.search = params.drug;
      } else {
        // 没有具体搜索条件，返回空结果
        const result: RAGResult = {
          source: "openfda",
          query: params.query,
          drug: params.drug,
          condition: params.condition,
          top_chunks: [],
          summary: "请提供药物名称或具体查询条件以获取 FDA 标签信息。",
          citations: []
        };
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      }

      // 2. 抓取数据
      const data = await this.makeRequest(searchParams);
      
      if (!data.results || data.results.length === 0) {
        const result: RAGResult = {
          source: "openfda",
          query: params.query,
          drug: params.drug,
          condition: params.condition,
          top_chunks: [],
          summary: "未找到匹配的 FDA 药物标签数据。请尝试调整搜索条件。",
          citations: []
        };
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      }

      // 3. 提取和分块文本
      const allChunks: TextChunk[] = [];
      
      for (const label of data.results) {
        const labelText = this.extractLabelText(label);
        if (labelText.trim().length > 0) {
          const labelId = label.id || label.openfda?.spl_id?.[0] || `label_${Math.random().toString(36).substr(2, 9)}`;
          const drugName = label.openfda?.brand_name?.[0] || label.openfda?.generic_name?.[0] || 'Unknown Drug';
          
          const chunks = chunkText(
            labelText,
            1000,
            200,
            labelId,
            {
              drugName,
              manufacturer: label.openfda?.manufacturer_name?.[0],
              type: 'fda_label',
              hasWarnings: !!(label.warnings || label.boxed_warning),
              hasAdverseReactions: !!label.adverse_reactions
            }
          );
          
          allChunks.push(...chunks);
        }
      }

      // 4. 构建查询关键词
      const queryText = [params.query, params.drug, params.condition]
        .filter(Boolean)
        .join(' ');
      
      const extraKeywords = [
        'adverse reactions', 'side effects', 'warnings', 'contraindications',
        'boxed warning', 'precautions', 'safety', 'toxicity',
        '不良反应', '副作用', '警告', '禁忌症', '安全性'
      ];

      // 5. 检索和排序
      const topChunks = rankAndPickTop(
        allChunks,
        queryText,
        params.top_k,
        extraKeywords
      );

      // 6. 生成摘要
      const summary = summarizeChunks(topChunks, {
        source: 'openfda',
        query: params.query,
        drug: params.drug,
        condition: params.condition,
        maxLength: 1200
      });

      // 7. 提取引用
      const citations = extractCitations(topChunks);

      // 8. 构建结果
      const result: RAGResult = {
        source: "openfda",
        query: params.query,
        drug: params.drug,
        condition: params.condition,
        top_chunks: topChunks.map(chunk => ({
          ...chunk,
          text: chunk.text.length > 1200 ? chunk.text.slice(0, 1200) + '...' : chunk.text
        })),
        summary,
        citations
      };

      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }]
      };
      
    } catch (error) {
      console.error("Error in ae_pipeline_rag:", error);
      throw new McpError(
        ErrorCode.InternalError,
        `RAG pipeline failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private extractLabelText(label: any): string {
    const textParts: string[] = [];
    
    // 基本信息
    const drugName = label.openfda?.brand_name?.[0] || label.openfda?.generic_name?.[0] || 'Unknown Drug';
    const manufacturer = label.openfda?.manufacturer_name?.[0] || 'Unknown Manufacturer';
    textParts.push(`Drug: ${drugName}`);
    textParts.push(`Manufacturer: ${manufacturer}`);
    
    // 适应症和用法
    if (label.indications_and_usage) {
      textParts.push("=== INDICATIONS AND USAGE ===");
      if (Array.isArray(label.indications_and_usage)) {
        textParts.push(label.indications_and_usage.join('\n'));
      } else {
        textParts.push(label.indications_and_usage);
      }
    }
    
    // 剂量和给药方法
    if (label.dosage_and_administration) {
      textParts.push("=== DOSAGE AND ADMINISTRATION ===");
      if (Array.isArray(label.dosage_and_administration)) {
        textParts.push(label.dosage_and_administration.join('\n'));
      } else {
        textParts.push(label.dosage_and_administration);
      }
    }
    
    // 禁忌症（重点）
    if (label.contraindications) {
      textParts.push("=== CONTRAINDICATIONS ===");
      if (Array.isArray(label.contraindications)) {
        textParts.push(label.contraindications.join('\n'));
      } else {
        textParts.push(label.contraindications);
      }
    }
    
    // 警告和注意事项（重点）
    if (label.warnings) {
      textParts.push("=== WARNINGS ===");
      if (Array.isArray(label.warnings)) {
        textParts.push(label.warnings.join('\n'));
      } else {
        textParts.push(label.warnings);
      }
    }
    
    // 黑框警告（最重要）
    if (label.boxed_warning) {
      textParts.push("=== BOXED WARNING ===");
      if (Array.isArray(label.boxed_warning)) {
        textParts.push(label.boxed_warning.join('\n'));
      } else {
        textParts.push(label.boxed_warning);
      }
    }
    
    // 注意事项
    if (label.precautions) {
      textParts.push("=== PRECAUTIONS ===");
      if (Array.isArray(label.precautions)) {
        textParts.push(label.precautions.join('\n'));
      } else {
        textParts.push(label.precautions);
      }
    }
    
    // 不良反应（重点）
    if (label.adverse_reactions) {
      textParts.push("=== ADVERSE REACTIONS ===");
      if (Array.isArray(label.adverse_reactions)) {
        textParts.push(label.adverse_reactions.join('\n'));
      } else {
        textParts.push(label.adverse_reactions);
      }
    }
    
    // 药物相互作用
    if (label.drug_interactions) {
      textParts.push("=== DRUG INTERACTIONS ===");
      if (Array.isArray(label.drug_interactions)) {
        textParts.push(label.drug_interactions.join('\n'));
      } else {
        textParts.push(label.drug_interactions);
      }
    }
    
    return textParts.join('\n\n');
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("OpenFDA Drug Label MCP server running on stdio");
  }
}

const server = new OpenFDAServer();
server.run().catch(console.error);
