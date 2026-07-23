import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, isAbsolute, basename } from "node:path";
import type { Tool, ToolResult } from "../types/tools.js";
import { strArg } from "./utils.js";
import type { SkillManager } from "../skills/manager.js"

function nameFromFrontmatter(content: string): string {
  if (!content.startsWith("---")) return "";
  const end = content.indexOf("---", 3);
  if (end === -1) return "";
  const m = content.slice(3, end).match(/(?:^|\n)\s*name:\s*(.+)/);
  return m ? m[1].trim() : "";
}

// Installs a skill from a local file path or an https URL into
// .mewcode/skills/<name>/SKILL.md, then reloads the catalog. Mirrors Go's
// InstallSkill tool.
export class InstallSkillTool implements Tool {
  name = "InstallSkill";
  description = "Install a skill from a local file path or an https URL into .nuomi/skills.";
  category = "read" as const;
  system = true;

  constructor(
    private workDir: string,
    private skillManager: SkillManager,
    private onInstalled?: () => void
  ) { }

  schema(): Record<string, unknown> {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {
          source: { type: "string", description: "Local path or https URL to a SKILL.md" },
          name: { type: "string", description: "Optional skill name (defaults to frontmatter name)" },
        },
        required: ["source"],
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    // 拿到source
    const source = strArg(args, "source");
    //如果source不存在，则返回错误
    if (!source) return { output: "Error: source is required", isError: true };

    let content: string;
    // 匹配是不是远程http的source资源
    if (/^https?:\/\//.test(source)) {
      try {
        // 是外部链接的话，请求这个资源
        const resp = await fetch(source);
        //如果请求失败，也返回失败，告诉Agent
        if (!resp.ok) return { output: `Error: fetch failed (${resp.status})`, isError: true };
        // 不然的话，就写入content
        content = await resp.text();
      } catch (e) {
        return { output: `Error fetching skill: ${(e as Error).message}`, isError: true };
      }
    } else {
      // 是内部文件的path
      //如果是绝对路径，则返回路径，如果是相对路径，则加上当前工作目录
      const p = isAbsolute(source) ? source : join(this.workDir, source);
      // 如果说这个路径不止，则返回错误给Agent
      if (!existsSync(p)) return { output: `Error: file not found: ${source}`, isError: true };
      // 最后读取文件内容
      content = readFileSync(p, "utf-8");
    }
    // 拿到工具调用是skill的名字
    const name = strArg(args, "name") || nameFromFrontmatter(content) || basename(source).replace(/\.md$/, "");
    if (!name) return { output: "Error: could not determine skill name", isError: true };

    const dir = join(this.workDir, ".nuomi", "skills", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), content, "utf-8");

    this.skillManager.load(this.workDir);
    this.onInstalled?.();

    return { output: `Skill '${name}' installed to .nuomi/skills/${name}/SKILL.md`, isError: false };
  }
}
