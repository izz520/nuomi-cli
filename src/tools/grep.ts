import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, matchesGlob, relative } from "node:path";
import type { Tool, ToolResult, ToolContext } from "../types/tools.js";
import { strArg, SKIP_DIRS } from "./utils.js";
import { GrepDescription } from "./prompt.js";

const MAX_RESULTS = 500;

export class GrepTool implements Tool {
  name = "Grep";
  description = GrepDescription;
  category = "read" as const;

  schema(): Record<string, unknown> {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern to search for" },
          path: { type: "string", description: "Directory or file to search in", default: "." },
          include: { type: "string", description: "File pattern filter (e.g., '*.ts')" },
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

    const searchPath = strArg(args, "path", ctx.workDir);
    const include = strArg(args, "include");

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, "i");
    } catch {
      return { output: `Error: invalid regex pattern: ${pattern}`, isError: true };
    }

    const results: string[] = [];

    function walk(dir: string): void {
      if (results.length >= MAX_RESULTS) return;

      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }

      for (const entry of entries) {
        if (results.length >= MAX_RESULTS) return;
        if (SKIP_DIRS.has(entry)) continue;

        const fullPath = join(dir, entry);
        let stat;
        try {
          stat = statSync(fullPath);
        } catch {
          continue;
        }

        if (stat.isDirectory()) {
          walk(fullPath);
        } else if (stat.isFile()) {
          if (include && !matchesGlob(entry, include)) continue;
          searchFile(fullPath);
        }
      }
    }

    function searchFile(filePath: string): void {
      try {
        const content = readFileSync(filePath, "utf-8");
        const lines = content.split("\n");
        const rel = relative(ctx.workDir, filePath);

        for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
          if (regex.test(lines[i])) {
            results.push(`${rel}:${i + 1}:${lines[i]}`);
          }
        }
      } catch {
        // skip binary or unreadable files
      }
    }

    try {
      const stat = statSync(searchPath);
      if (stat.isFile()) {
        searchFile(searchPath);
      } else {
        walk(searchPath);
      }
    } catch (err) {
      return { output: `Error: ${(err as Error).message}`, isError: true };
    }

    if (results.length === 0) {
      return { output: "No matches found.", isError: false };
    }

    let output = results.join("\n");
    if (results.length >= MAX_RESULTS) {
      output += `\n\n(results truncated at ${MAX_RESULTS} matches)`;
    }
    return { output, isError: false };
  }
}
