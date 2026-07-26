import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";
import { BUILTIN_AGENTS } from "./internal-agent.js";
import { SubAgent } from "../types/subAgent.js";

/**
 * 加载 Agent 定义：内置 → 用户级 (~/.mewcode/agents/) → 项目级 (.mewcode/agents/)。
 * 后加载的同名定义覆盖先前的，优先级：项目 > 用户 > 内置。
 */
export function loadSubAgents(workDir: string): SubAgent[] {
  // 拿到内置代理BUILTIN_AGENTS
  const definitions = [...BUILTIN_AGENTS];

  // 用户级目录：~/.mewcode/agents/
  const home = homedir();
  if (home) {
    loadDir(join(home, ".mewcode", "agents"), definitions);
  }

  // 项目级目录：<workDir>/.mewcode/agents/
  const dirs = [join(workDir, ".mewcode", "agents")];
  for (const dir of dirs) {
    loadDir(dir, definitions);
  }

  return definitions;
}

/** 扫描目录下所有 .md 文件并解析为 Agent 定义，同名覆盖 */
function loadDir(dir: string, subAgents: SubAgent[]): void {
  // 如果文件目录不存在，则跳过
  if (!existsSync(dir)) return;
  // 读取文件目录里面的.md文件
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  // 循环.md文件
  for (const file of files) {
    try {
      // 读取md的内容
      const content = readFileSync(join(dir, file), "utf-8");
      // 拿到md的头信息和body信息
      const def = parseAgentDefinition(content);
      if (def) {
        // 查看是都已经存在了
        const existing = subAgents.findIndex((d) => d.name === def.name);
        if (existing >= 0) {
          // 存在的话，直接覆盖掉
          subAgents[existing] = def;
        } else {
          // 不存在，则添加进去
          subAgents.push(def);
        }
      }
    } catch {
      continue;
    }
  }
}

function parseAgentDefinition(content: string): SubAgent | null {
  // 如果不是---开头，表示不规范，直接返回null
  if (!content.startsWith("---")) return null;
  // 找到---结束的位置
  const endIdx = content.indexOf("---", 3);
  // 如果没有结束的---位置，也表示不规范，直接返回null
  if (endIdx === -1) return null;
  // 拿到yarml的定义
  const frontmatter = content.slice(3, endIdx).trim();
  // 拿到内容
  const body = content.slice(endIdx + 3).trim();

  try {
    // 解析头信息
    const raw = yaml.load(frontmatter) as Record<string, unknown> | null;
    // 头信息不存在，也返回null
    if (!raw?.name) return null;
    // 返回头信息以及body信息
    return {
      name: raw.name as string,
      description: (raw.description as string) ?? body.slice(0, 200),
      tools: raw.tools as string[] | undefined,
      disallowedTools: raw.disallowed_tools as string[] | undefined,
      systemPromptOverride: raw.system_prompt as string | undefined,
      maxTurns: raw.max_turns as number | undefined,
      model: raw.model as string | undefined,
      background: raw.background as boolean | undefined,
      isolation: raw.isolation as "worktree" | undefined,
      initialPrompt: body || undefined,
    };
  } catch {
    return null;
  }
}
