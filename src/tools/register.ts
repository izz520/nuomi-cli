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

    findDeferredByNames(names: string[]): Tool[] {
        return names
            .map((n) => this.tools.get(n))
            .filter((t): t is Tool => t !== undefined && t.deferred === true);
    }
    markDiscovered(name: string): void {
        this.discovered.add(name);
    }

    unregister(name: string): void {
        this.tools.delete(name);
        this.discovered.delete(name);
    }
    searchDeferred(
        query: string,
        maxResults = 5
    ): Tool[] {
        const keywords = [
            ...new Set(
                query
                    .toLowerCase()
                    .match(/[\p{L}\p{N}_-]+/gu) ?? []
            ),
        ];

        if (keywords.length === 0) {
            return [];
        }

        const matches: Array<{
            tool: Tool;
            score: number;
        }> = [];

        for (const tool of this.tools.values()) {
            if (
                !tool.deferred ||
                this.discovered.has(tool.name)
            ) {
                continue;
            }

            const name = tool.name.toLowerCase();
            const description = tool.description.toLowerCase();

            let score = 0;

            for (const keyword of keywords) {
                if (name === keyword) {
                    score += 10;
                } else if (name.includes(keyword)) {
                    score += 4;
                }

                if (description.includes(keyword)) {
                    score += 1;
                }
            }

            if (score > 0) {
                matches.push({ tool, score });
            }
        }

        return matches
            .sort((a, b) => b.score - a.score)
            .slice(0, Math.max(1, maxResults))
            .map(({ tool }) => tool);
    }
}