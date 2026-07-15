import type { Tool, ToolResult, ToolContext } from "../types/tools.js"
import { strArg, intArg } from "./utils.js";
import type { ToolsManger } from "./register.js";

export class ToolSearchTool implements Tool {
  name = "ToolSearch";
  description = "Search for and load deferred tools by name or keyword.";
  category = "read" as const;
  system = true;
  private registry: ToolsManger;

  constructor(registry: ToolsManger) {
    this.registry = registry;
  }

  schema(): Record<string, unknown> {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              'Search query. Use "select:name1,name2" to load specific tools by name, or keywords to search.',
          },
          max_results: { type: "integer", description: "Max results to return", default: 5 },
        },
        required: ["query"],
      },
    };
  }

  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    //拿到工具的query
    const query = strArg(args, "query");
    console.log("query", query);

    //在拿到最大结果数量
    const maxResults = intArg(args, "max_results", 5);
    if (!query) {
      //如果query不存在，则直接返回错误，query是必须的
      return { output: "Error: query is required", isError: true };
    }

    // Handle "select:name1,name2" syntax
    //匹配query是不是精确需要哪些工具
    if (query.startsWith("select:")) {
      //切割掉"select:",然后再根据“，”分割，拿到工具的具体名字
      const names = query.slice(7).split(",").map((n) => n.trim());
      //去工具管理器中查询并返回本次想要调用的全部工具MCP
      const tools = this.registry.findDeferredByNames(names);
      for (const t of tools) {
        //循环把这个工具标记成已使用，下次获取schemas的时候，就会拿到这次需要的工具
        this.registry.markDiscovered(t.name);
      }
      if (tools.length === 0) {
        //工具没有找到，返回没有找到给AI
        return { output: `No deferred tools found matching: ${names.join(", ")}`, isError: false };
      }
      const schemas = tools.map((t) => JSON.stringify(t.schema(), null, 2));
      //把找到的结果返回给AI
      return { output: schemas.join("\n\n"), isError: false };
    }

    // Keyword search
    //关键词搜索到工具列表
    const tools = this.registry.searchDeferred(query, maxResults);
    if (tools.length === 0) {
      //如果工具列表为空，则表示没有一个匹配到的
      return { output: "No deferred tools matched the query.", isError: false };
    }
    //匹配到了工具，然后格式化成工具名：工具简单描述
    const lines = tools.map(
      (t) => `- ${t.name}: ${t.description.slice(0, 100)}`
    );
    //返回给AI
    return { output: lines.join("\n"), isError: false };
  }
}
