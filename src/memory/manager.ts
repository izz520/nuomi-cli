import { readFileSync, readdirSync, unlinkSync, existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { homedir } from "node:os";
import { load } from "js-yaml";
// import type { LLMClient } from "../llm/client.js";
import { MessageManager } from "../messageManager/message.js";
import OpenAIClient from "../client/openai.js";
import AnthropicClient from "../client/anthorpic.js";

/** Caps for MEMORY.md index content: 200 lines or 25KB, whichever is hit first. */
const MAX_ENTRYPOINT_LINES = 200;
const MAX_ENTRYPOINT_BYTES = 25_000;
const MEMORY_INDEX_NAME = "MEMORY.md";

export interface MemoryFile {
  path: string;
  name: string;
  description: string;
  type: string;
  content: string;
}

/** Header metadata from a scanned memory file, used by findRelevantMemories. */
export interface MemoryHeader {
  filename: string;   // path relative to the memory dir
  filePath: string;   // absolute path
  scope: string;      // "user" or "project"
  mtimeMs: number;    // modification time, ms since epoch
  description: string;
  type: string;
}

/** One memory selected for surfacing into the main conversation. */
export interface RelevantMemory {
  path: string;
  mtimeMs: number;
}

/** The system prompt for the selector agent. Mirrors the Go SelectMemoriesSystemPrompt. */
const SELECT_MEMORIES_SYSTEM_PROMPT = `You are selecting memories that will be useful to MewCode as it processes a user's query. You will be given the user's query and a list of available memory files with their filenames and descriptions.

Return a list of filenames for the memories that will clearly be useful to MewCode as it processes the user's query (up to 5). Only include memories that you are certain will be helpful based on their name and description.
- If you are unsure if a memory will be useful in processing the user's query, then do not include it in your list. Be selective and discerning.
- If there are no memories in the list that would clearly be useful, feel free to return an empty list.
- If a list of recently-used tools is provided, do not select memories that are usage reference or API documentation for those tools (MewCode is already exercising them). DO still select memories containing warnings, gotchas, or known issues about those tools — active use is exactly when those matter.

Respond with valid JSON only, no markdown, in this exact shape: {"selected_memories": ["filename1.md", "filename2.md"]}`;

export class MemoryManager {
  private userDir: string;
  private projectDir: string;

  constructor(workDir: string) {
    //系统的配置目录 
    this.userDir = join(homedir(), ".nuomi", "memory");
    // 项目的配置目录
    this.projectDir = join(workDir, ".nuomi", "memory");
  }

  loadAll(): MemoryFile[] {
    const memories: MemoryFile[] = [];
    // 循环系统配置目录和项目配置目录
    // ~/.nuomi/memory || /project/.nuomi/memory
    for (const dir of [this.userDir, this.projectDir]) {
      // 如果不存在则跳过
      if (!existsSync(dir)) continue;
      //读取目录里面的文件，并且过滤掉MEMORY.md
      const files = readdirSync(dir).filter(
        (f) => f.endsWith(".md") && f !== MEMORY_INDEX_NAME
      );
      // 循环读取文档
      for (const file of files) {
        // 拿到完整的路径
        const fullPath = join(dir, file);
        try {
          // 读取文件内容
          const raw = readFileSync(fullPath, "utf-8");
          // 解析内容
          const parsed = parseFrontmatter(raw);
          if (parsed) {
            //如果内容存在，就push进memories
            memories.push({
              path: fullPath,
              name: parsed.name ?? file.replace(".md", ""),
              description: parsed.description ?? "",
              type: parsed.type ?? "reference",
              content: parsed.body,
            });
          }
        } catch {
          continue;
        }
      }
    }
    // 根据内容创建MEMORY.md
    this.rebuildIndex();
    // 返回所有的内容
    return memories;
  }

  getMemories(): MemoryFile[] {
    return this.loadAll();
  }

  buildSystemReminder(): string {
    //拿到所有的记忆
    const memories = this.loadAll();
    //如果记忆为空，则返回空
    if (memories.length === 0) return "";
    //循环所有记忆内容
    const lines = memories.map(
      (m) => `- [${m.name}] (${m.type}): ${m.description}`
    );
    return `Active memories:\n${lines.join("\n")}`;
  }

  clear(): void {
    for (const dir of [this.userDir, this.projectDir]) {
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
      for (const file of files) {
        try {
          unlinkSync(join(dir, file));
        } catch {
          continue;
        }
      }
    }
  }

  // ── Feature 1: MEMORY.md index generation ──────────────────────────

  /**
   * Scans both userDir and projectDir for .md files (excluding MEMORY.md),
   * parses each file's frontmatter for name + description, and writes a
   * MEMORY.md index in the projectDir. One line per memory, sorted
   * alphabetically by name, truncated at MAX_ENTRYPOINT_LINES / MAX_ENTRYPOINT_BYTES.
   */
  //扫描用户级和项目级的所有记忆 Markdown 文件，为它们生成一个目录索引，并写入项目的 MEMORY.md。
  rebuildIndex(): void {
    const entries: { name: string; relPath: string; description: string }[] = [];
    //循环系统配置目录和用户配置目录
    for (const dir of [this.userDir, this.projectDir]) {
      //目录不存在就跳过
      if (!existsSync(dir)) continue;
      // 读取目录里面的非MEMORY.md的文件
      const files = readdirSync(dir).filter(
        (f) => f.endsWith(".md") && f !== MEMORY_INDEX_NAME
      );
      // 循环文件
      for (const file of files) {
        // 拿到全路径
        const fullPath = join(dir, file);
        try {
          // 读取内容
          const raw = readFileSync(fullPath, "utf-8");
          //解析内容
          const parsed = parseFrontmatter(raw);
          // 内容解析失败就跳过
          if (!parsed) continue;
          const name = parsed.name ?? file.replace(".md", "");
          const description = parsed.description ?? "";
          // Relative path from projectDir so the link works from MEMORY.md
          //相对于this.projectDir之后fullPath的路径
          const relPath = relative(this.projectDir, fullPath) || file;
          entries.push({ name, relPath, description });
        } catch {
          continue;
        }
      }
    }

    // Sort alphabetically by name (case-insensitive)
    //根据 name 按字母顺序排序
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    // Build index lines
    const lines: string[] = [];
    // 循环转换
    for (const e of entries) {
      if (e.description) {
        //转换成 - [编码规范](coding-style.md) — TypeScript 编码要求
        lines.push(`- [${e.name}](${e.relPath}) — ${e.description}`);
      } else {
        //转换成- [编码规范](coding-style.md)
        lines.push(`- [${e.name}](${e.relPath})`);
      }
    }

    // Truncate to MAX_ENTRYPOINT_LINES
    //最多200行
    let content = lines.slice(0, MAX_ENTRYPOINT_LINES).join("\n");

    // Truncate to MAX_ENTRYPOINT_BYTES at a newline boundary
    //如果内容大小超过25000个字节也要被截断掉
    if (Buffer.byteLength(content, "utf-8") > MAX_ENTRYPOINT_BYTES) {
      // Find the last newline before the byte cap
      const buf = Buffer.from(content, "utf-8");
      const truncBuf = buf.subarray(0, MAX_ENTRYPOINT_BYTES);
      const truncStr = truncBuf.toString("utf-8");
      const lastNL = truncStr.lastIndexOf("\n");
      content = lastNL > 0 ? truncStr.slice(0, lastNL) : truncStr;
    }

    // Write MEMORY.md into projectDir, ensuring the dir exists
    //创建项目记忆目录
    mkdirSync(this.projectDir, { recursive: true });
    // 写入MEMORY.md
    writeFileSync(join(this.projectDir, MEMORY_INDEX_NAME), content + "\n", "utf-8");
  }

  // ── Feature 2: findRelevantMemories ────────────────────────────────

  /**
   * Scans all memory headers from both dirs, asks the LLM to select the
   * top 5 most relevant ones for the query, and returns the full content
   * of those files. Best-effort: selector failures return an empty array.
   */
  async findRelevantMemories(
    //用户发送的消息内容
    query: string,
    //当前的provider
    client: OpenAIClient | AnthropicClient,
    // 最近使用的工具
    recentTools: string[] = [],
    // ？？
    alreadySurfaced: Set<string> = new Set()
  ): Promise<RelevantMemory[]> {
    // 1. Scan both dirs for memory headers
    const allHeaders: MemoryHeader[] = [];
    //循环系统的和项目的
    for (const [dir, scope] of [[this.userDir, "user"], [this.projectDir, "project"]] as const) {
      // 返回读取的内容
      const headers = scanMemoryHeaders(dir, scope);
      //全部加进去
      allHeaders.push(...headers);
    }

    // Filter out already-surfaced files
    //过滤掉已经处理过的
    const candidates = allHeaders.filter((h) => !alreadySurfaced.has(h.filePath));
    if (candidates.length === 0) return [];
    //转换成markdown
    // 2. Build the manifest and ask the LLM to select
    const manifest = formatMemoryManifest(candidates);
    let toolsSection = "";
    if (recentTools.length > 0) {
      //工具调用存在的话，就加入工具调用
      toolsSection = "\n\nRecently used tools: " + recentTools.join(", ");
    }
    //拼接prompt
    const userMessage = `Query: ${query}\n\nAvailable memories:\n${manifest}${toolsSection}`;

    let rawResponse = "";
    try {
      //创建一个会话管理器
      const messageManager = new MessageManager();
      // The TS LLMClient binds system prompts at construction time, so we
      // inline the selector instructions as a user message (same pattern as
      // the MemoryExtractor).
      //把这个消息变成用户发送的消息
      messageManager.addUserMessage(SELECT_MEMORIES_SYSTEM_PROMPT + "\n\n" + userMessage);

      const stream = client.sendMessageStream(messageManager, []);
      for await (const event of stream) {
        if (event.type === "text_delta") {
          rawResponse += event.text;
        }
      }
    } catch {
      return [];
    }

    // 3. Parse the selector response
    const jsonStr = extractJSONObject(rawResponse);
    if (!jsonStr) return [];

    let parsed: { selected_memories?: string[] };
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return [];
    }

    if (!Array.isArray(parsed.selected_memories)) return [];

    // Build lookup maps: by filePath and by filename (relative)
    const byKey = new Map<string, MemoryHeader>();
    for (const h of candidates) {
      byKey.set(h.filePath, h);
      if (!byKey.has(h.filename)) {
        byKey.set(h.filename, h);
      }
    }

    // 4. Resolve selected filenames to RelevantMemory objects
    const selected: RelevantMemory[] = [];
    for (const fn of parsed.selected_memories) {
      const h = byKey.get(fn);
      if (!h) continue;
      selected.push({ path: h.filePath, mtimeMs: h.mtimeMs });
    }

    return selected;
  }
}

// ── Scanning / manifest helpers (parallel to Go ScanMemoryFiles / FormatMemoryManifest) ──

/**
 * Scans a memory directory for .md files (excluding MEMORY.md), reads
 * their frontmatter, and returns headers sorted newest-first (capped at
 * MAX_ENTRYPOINT_LINES files).
 */
function scanMemoryHeaders(dir: string, scope: string): MemoryHeader[] {
  //目录不存在就跳过了
  if (!existsSync(dir)) return [];

  let files: string[];
  try {
    // 读取这个项目文件夹并且过滤掉MEMORY.md
    files = readdirSync(dir).filter(
      (f) => f.endsWith(".md") && f !== MEMORY_INDEX_NAME
    );
  } catch {
    return [];
  }

  const headers: MemoryHeader[] = [];
  //循环这个目录下的全部文件
  for (const file of files) {
    // 拿到全路径
    const fullPath = join(dir, file);
    try {
      //获取文件或目录的详细信息
      const stat = statSync(fullPath);
      // 如果不是文件，则返回
      if (!stat.isFile()) continue;
      // 读取文件内容
      const raw = readFileSync(fullPath, "utf-8");
      // 解析内容
      const parsed = parseFrontmatter(raw);
      if (!parsed) continue;
      //把解析的内容存进headers
      headers.push({
        filename: file,
        filePath: fullPath,
        scope,
        mtimeMs: stat.mtimeMs, //文件最后被修改的时间
        description: parsed.description ?? "",
        type: parsed.type ?? "",
      });
    } catch {
      continue;
    }
  }

  // Sort newest-first
  //按照文件修改时间排序，最新的在最前面
  headers.sort((a, b) => b.mtimeMs - a.mtimeMs);
  // 判断是否超过200条的限制
  if (headers.length > MAX_ENTRYPOINT_LINES) {
    headers.length = MAX_ENTRYPOINT_LINES;
  }
  return headers;
}

/**
 * Formats memory headers as a text manifest for the selector prompt.
 * One line per file: - [scope] [type] filepath (timestamp): description
 */
function formatMemoryManifest(memories: MemoryHeader[]): string {
  if (memories.length === 0) return "";

  const lines: string[] = [];
  for (const m of memories) {
    const scope = m.scope ? `[${m.scope}-scope] ` : "";
    const tag = m.type ? `[${m.type}] ` : "";
    const ts = new Date(m.mtimeMs).toISOString();
    const path = m.filePath || m.filename;
    if (m.description) {
      //  "- [user-scope] [user] /xxx/language.md (...): 用户语言偏好",
      lines.push(`- ${scope}${tag}${path} (${ts}): ${m.description}`);
    } else {
      lines.push(`- ${scope}${tag}${path} (${ts})`);
    }
  }
  return lines.join("\n");
}

/**
 * Extracts the first {...} JSON object from raw text, tolerating markdown
 * fences or prose around it.
 */
function extractJSONObject(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.indexOf("{");
  if (start < 0) return "";
  const end = trimmed.lastIndexOf("}");
  if (end < start) return "";
  return trimmed.slice(start, end + 1);
}

/**
 * 解析 frontmatter，提取 name/description/type。
 * type 字段从顶层读取（跨语言兼容），同时兼容旧的 metadata.type 嵌套格式。
 */
function parseFrontmatter(
  content: string
): { name?: string; description?: string; type?: string; body: string } | null {
  if (!content.startsWith("---")) {
    //如果内容不是"---""开头，则把内容放进body返回
    return { body: content };
  }
  //找到第二个----的下标
  const endIdx = content.indexOf("---", 3);
  // 下标不存在，则把内容放进body返回
  if (endIdx === -1) return { body: content };
  //拿到----和----之间的内容
  const frontmatter = content.slice(3, endIdx).trim();
  // 跳过两个---后，拿到全部内容
  const body = content.slice(endIdx + 3).trim();

  try {
    //转换---之间的内容
    /** eg
     * ---
      name: coding-style
      description: 项目编码规范
      type: rule
      ---
     */
    const parsed = load(frontmatter) as Record<string, unknown> | null;
    // 优先读取顶层 type（Go 兼容格式），回退到 metadata.type（旧 TS 格式）
    //拿到类型
    const topType = parsed?.type as string | undefined;
    // 类型兼容
    const nestedType = (parsed?.metadata as Record<string, unknown>)?.type as string | undefined;
    return {
      name: parsed?.name as string | undefined,
      description: parsed?.description as string | undefined,
      type: topType ?? nestedType,
      body,
    };
  } catch {
    return { body: content };
  }
}
