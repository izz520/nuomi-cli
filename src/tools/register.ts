import { Tool } from "../types/tools.js";

export class ToolsManger {
    private tools = new Map<string, Tool>();
    private discovered = new Set<string>();
    register(tool: Tool): void {
        this.tools.set(tool.name, tool);
    }

    get(name: string): Tool | undefined {
        return this.tools.get(name);
    }

    listTools(): Tool[] {
        return [...this.tools.values()];
    }
    //查看所有的
    getAllSchemas(protocol: "anthropic" | "openai" | "openai-compat" = "anthropic"): Record<string, unknown>[] {
        const schemas: Record<string, unknown>[] = [];
        //循环所有的tools
        for (const tool of this.tools.values()) {
            //如果MCP的延迟加载为true，
            if (tool.deferred && !this.discovered.has(tool.name)) continue;
            //从schema中拿到基础信息
            const base = tool.schema();
            //如果是openai类型的，则按照openai格式添加
            if (protocol === "openai" || protocol === "openai-compat") {
                schemas.push({
                    type: "function",
                    function: {
                        name: base.name,
                        description: base.description,
                        parameters: base.input_schema,
                    },
                });
            } else {
                //anthropic的，则直接添加
                schemas.push(base);
            }
        }
        return schemas;
    }
    searchDeferred(query: string, maxResults = 5): Tool[] {
        const lower = query.toLowerCase();
        const matches: Tool[] = [];
        for (const tool of this.tools.values()) {
            if (!tool.deferred || this.discovered.has(tool.name)) continue;
            if (
                tool.name.toLowerCase().includes(lower) ||
                tool.description.toLowerCase().includes(lower)
            ) {
                matches.push(tool);
                if (matches.length >= maxResults) break;
            }
        }
        return matches;
    }

    findDeferredByNames(names: string[]): Tool[] {
        return names
            .map((n) => this.tools.get(n))
            .filter((t): t is Tool => t !== undefined && t.deferred === true);
    }
    markDiscovered(name: string): void {
        this.discovered.add(name);
    }
}