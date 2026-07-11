// 来源：公众号@小林coding
// 后端八股网站：xiaolincoding.com
// Agent网站：xiaolinnote.com
// 简历模版：jianli.xiaolinnote.com

import { readFileSync, existsSync, statSync } from "node:fs";
import type { Tool, ToolResult, ToolContext } from "../types/tools.js";
import { ReadFileDescription } from "./descriptions.js";

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

export function strArg(
  args: Record<string, unknown>,
  key: string,
  fallback = ""
): string {
  const v = args[key];
  if (typeof v === "string") return v;
  return fallback;
}

export class ReadFileTool implements Tool {
  name = "ReadFile";
  description = ReadFileDescription;
  category = "read" as const;

  schema(): Record<string, unknown> {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Absolute path to the file" },
          offset: { type: "integer", description: "Line number to start from (0-based)", default: 0 },
          limit: { type: "integer", description: "Max lines to read", default: 2000 },
        },
        required: ["file_path"],
      },
    };
  }

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    // console.log("🚀 ~ ReadFileTool ~ execute ~ args:", args.file_path)
    const filePath = strArg(args, "file_path");
    console.log("🚀 ~ ReadFileTool ~ execute ~ filePath:", filePath)
    if (!filePath) {
      return { output: "Error: file_path is required", isError: true };
    }

    if (!existsSync(filePath)) {
      return { output: `Error: file not found: ${filePath}`, isError: true };
    }

    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      return { output: `Error: ${filePath} is a directory, not a file. Use Glob to list directory contents.`, isError: true };
    }

    const offset = intArg(args, "offset", 0);
    const limit = intArg(args, "limit", 2000);

    try {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const slice = lines.slice(offset, offset + limit);

      // Register the file as "read" in the state cache so subsequent
      // EditFile / WriteFile calls are allowed.
      // ctx.fileStateCache?.record(filePath, content, stat.mtimeMs);

      const numbered = slice.map((line, i) => `${offset + i + 1}\t${line}`);
      return { output: numbered.join("\n"), isError: false };
    } catch (err) {
      return { output: `Error reading file: ${(err as Error).message}`, isError: true };
    }
  }
}
