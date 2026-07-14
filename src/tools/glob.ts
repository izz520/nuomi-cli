import { globSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Tool, ToolResult, ToolContext } from "../types/tools.js";
import { strArg, SKIP_DIRS } from "./utils.js";
import { GlobDescription } from "./prompt.js";

export class GlobTool implements Tool {
  name = "Glob";
  description = GlobDescription;
  category = "read" as const;

  schema(): Record<string, unknown> {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern (e.g., '**/*.ts')" },
          path: { type: "string", description: "Base directory to search from", default: "." },
        },
        required: ["pattern"],
      },
    };
  }

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const pattern = strArg(args, "pattern");
    if (!pattern) {
      return { output: "Error: pattern is required", isError: true };
    }
    //拿到路径
    const basePath = strArg(args, "path", ctx.workDir);

    try {
      const matches = globSync(pattern, {
        cwd: basePath,
        exclude: (entry) => entry.split(/[\\/]/).some((part) => SKIP_DIRS.has(part)),
      }).slice(0, 1000);

      // 按修改时间倒序，最近修改的排前面
      matches.sort((a, b) => {
        try {
          const ma = statSync(join(basePath, a)).mtimeMs;
          const mb = statSync(join(basePath, b)).mtimeMs;
          return mb - ma;
        } catch {
          return a.localeCompare(b);
        }
      });

      if (matches.length === 0) {
        return { output: "No files matched the pattern.", isError: false };
      }

      return { output: matches.join("\n"), isError: false };
    } catch (err) {
      return { output: `Error: ${(err as Error).message}`, isError: true };
    }
  }
}
