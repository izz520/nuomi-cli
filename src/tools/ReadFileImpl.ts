import { Tool, ToolCategory, ToolContext, ToolResult } from "../types/tools.js";
import { ReadFileDescription } from "./descriptions.js";

// 读取文件的Tool
class ReadFile implements Tool {
    name = "ReadFile";
    description = ReadFileDescription;
    category = "read" as ToolCategory;
    //返回给LLM实例，同聊天一起发送给Agent
    schema(): Record<string, unknown> {
        return {
            //工具的名称
            name: this.name,
            // 工具的描述-尽可能的详细
            description: this.description,
            //输出的参数
            input_schema: {
                //输出参数的类型
                type: "object",
                //参数
                properties: {
                    file_path: { type: "string", description: "Absolute path to the file" },
                    offset: { type: "integer", description: "Line number to start from (0-based)", default: 0 },
                    limit: { type: "integer", description: "Max lines to read", default: 2000 },
                },
                //必须传的参数
                required: ["file_path"],
            },
        };
    };
    async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
        //1.从args从获取到path
        const filePath = args["file_path"] ?? ""
        //2.判断path是否为空
        if (!filePath) {
            return {
                output: "Error: file_path is required",
                isError: true
            }
        }
        return {
            output: "123",
            isError: true
        }
    }
}
