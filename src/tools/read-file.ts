import { existsSync, readFileSync, statSync } from "node:fs";
import { Tool, ToolCategory, ToolContext, ToolResult } from "../types/tools.js";
import { ReadFileDescription } from "./descriptions.js";
import writeLog from "../utils/writeLog.js";

export function intArg(
    args: Record<string, unknown>,
    key: string,
    fallback: number
): number {
    const v = args[key];
    if (typeof v === "number") return Math.floor(v);
    if (typeof v === "string") {
        const n = parseInt(v, 10);
        return isNaN(n) ? fallback : n;
    }
    return fallback;
}
// 读取文件的Tool
export class ReadFile implements Tool {
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
        writeLog("args", args)
        //1.从args从获取到path
        const filePath = args["file_path"] as string ?? ""
        //2.从args获取从第几行开始读取
        const offset = intArg(args, "offset", 0)
        //3.从args获取最多读取多少行
        const limit = intArg(args, "limit", 2000)
        //2.判断path是否为空
        if (!filePath) {
            return {
                output: "Error: file_path is required",
                isError: true
            }
        }
        //校验当前路径是否存在
        if (!existsSync(filePath)) {
            return { output: `Error: file not found: ${filePath}`, isError: true };
        }
        //读取某个路径对应的文件系统信息
        const stat = statSync(filePath);
        // 是否是目录
        if (stat.isDirectory()) {
            return { output: `Error: ${filePath} is a directory, not a file. Use Glob to list directory contents.`, isError: true };
        }
        try {
            //开始读文件,拿到内容
            const content = readFileSync(filePath, "utf-8");
            //根据换行符获取总行数
            const lines = content.split("\n");
            //只取其中的部分行数
            const slice = lines.slice(offset, offset + limit);

            // Register the file as "read" in the state cache so subsequent
            // EditFile / WriteFile calls are allowed.
            //ctx.fileStateCache?.record(filePath, content, stat.mtimeMs);
            //給内容加上行号
            const numbered = slice.map((line, i) => `${offset + i + 1}\t${line}`);
            //返回给Agent
            return { output: numbered.join("\n"), isError: false };
        } catch (err) {
            return { output: `Error reading file: ${(err as Error).message}`, isError: true };
        }
    }
}
