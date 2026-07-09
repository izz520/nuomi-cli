import { Tool } from "../types/tools.js";

export class RegisterTools {
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
            //
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
    //执行工具调用
    async execute(toolId: string, toolName: string, args: Record<string, unknown>) {
        //1.判断工具是否已经注册
        const tool = this.get(toolName)
        const start = Date.now();
        if (!tool) {
            return {
                toolId: toolId,
                toolName: toolName,
                result: {
                    output: `Error: unknown tool '${toolName}'`,
                    isError: true,
                },
                elapsed: 0,
            };
        }
        try {
            const result = await tool.execute(args);
            return {
                toolId: toolId,
                toolName: toolName,
                result,
                elapsed: (Date.now() - start) / 1000,
            };
        } catch (err) {
            return {
                toolId: toolId,
                toolName: toolName,
                result: {
                    output: `Error executing ${toolName}: ${(err as Error).message}`,
                    isError: true,
                },
                elapsed: (Date.now() - start) / 1000,
            };
        }
    }
}