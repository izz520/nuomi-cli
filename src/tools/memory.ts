import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { MemoryManager, MemoryScope } from "../memory/manager.js";
import type { Tool, ToolContext, ToolResult } from "../types/tools.js";
import { strArg } from "./utils.js";

const MAX_READ_CHARS = 8_000;
const MAX_WRITE_BYTES = 64 * 1024;

abstract class MemoryTool implements Tool {
  abstract name: string;
  abstract description: string;
  abstract category: "read" | "write";

  constructor(
    protected readonly memoryManager: MemoryManager,
    protected readonly onMutation: () => void = () => {},
  ) {}

  abstract schema(): Record<string, unknown>;
  abstract execute(args: Record<string, unknown>, ctx?: ToolContext): Promise<ToolResult>;

  protected resolve(args: Record<string, unknown>): string {
    return this.memoryManager.resolvePath(memoryScope(args), strArg(args, "path"));
  }
}

export class ReadMemoryTool extends MemoryTool {
  name = "ReadMemory";
  description = "Read a Markdown file from Nuomi persistent memory. Use MEMORY.md as the index and read topic files only when relevant.";
  category = "read" as const;

  schema(): Record<string, unknown> {
    return memorySchema(this.name, this.description, {});
  }

  async execute(args: Record<string, unknown>, _ctx?: ToolContext): Promise<ToolResult> {
    try {
      const filePath = this.resolve(args);
      const content = readFileSync(filePath, "utf8");
      const truncated = content.length > MAX_READ_CHARS;
      return {
        output: content.slice(0, MAX_READ_CHARS) + (truncated ? "\n… (memory truncated)" : ""),
        isError: false,
      };
    } catch (error) {
      return failure("reading", error);
    }
  }
}

export class WriteMemoryTool extends MemoryTool {
  name = "WriteMemory";
  description = "Atomically write verified, durable information to a Markdown file in Nuomi persistent memory.";
  category = "write" as const;

  schema(): Record<string, unknown> {
    return memorySchema(this.name, this.description, {
      content: { type: "string", description: "Complete Markdown content to write" },
    }, ["content"]);
  }

  async execute(args: Record<string, unknown>, _ctx?: ToolContext): Promise<ToolResult> {
    const content = strArg(args, "content");
    try {
      validateMemoryContent(content);
      const filePath = this.resolve(args);
      atomicWrite(filePath, content);
      this.onMutation();
      return { output: `Memory written: ${memoryScope(args)}/${strArg(args, "path")}`, isError: false };
    } catch (error) {
      return failure("writing", error);
    }
  }
}

export class EditMemoryTool extends MemoryTool {
  name = "EditMemory";
  description = "Replace one exact, unique passage in a Markdown file in Nuomi persistent memory.";
  category = "write" as const;

  schema(): Record<string, unknown> {
    return memorySchema(this.name, this.description, {
      oldText: { type: "string", description: "Exact unique text to replace" },
      newText: { type: "string", description: "Replacement text" },
    }, ["oldText", "newText"]);
  }

  async execute(args: Record<string, unknown>, _ctx?: ToolContext): Promise<ToolResult> {
    const oldText = strArg(args, "oldText");
    const newText = strArg(args, "newText");
    try {
      if (!oldText) throw new Error("oldText is required");
      const filePath = this.resolve(args);
      const content = readFileSync(filePath, "utf8");
      const occurrences = content.split(oldText).length - 1;
      if (occurrences !== 1) throw new Error(`oldText must occur exactly once; found ${occurrences}`);
      const next = content.replace(oldText, newText);
      validateMemoryContent(next);
      atomicWrite(filePath, next);
      this.onMutation();
      return { output: `Memory edited: ${memoryScope(args)}/${strArg(args, "path")}`, isError: false };
    } catch (error) {
      return failure("editing", error);
    }
  }
}

function memoryScope(args: Record<string, unknown>): MemoryScope {
  const scope = strArg(args, "scope");
  if (scope !== "user" && scope !== "project") {
    throw new Error("scope must be 'user' or 'project'");
  }
  return scope;
}

function memorySchema(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  additionalRequired: string[] = [],
): Record<string, unknown> {
  return {
    name,
    description,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        scope: { type: "string", enum: ["user", "project"] },
        path: { type: "string", description: "Relative Markdown path inside the selected memory scope" },
        ...properties,
      },
      required: ["scope", "path", ...additionalRequired],
    },
  };
}

function validateMemoryContent(content: string): void {
  if (!content) throw new Error("memory content is required");
  if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) {
    throw new Error(`memory content exceeds ${MAX_WRITE_BYTES} bytes`);
  }
  const unsafePatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    /\b(?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*["']?\S{12,}/i,
    /\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{16,}\b/i,
    /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}/i,
    /\bignore\s+(?:all\s+)?(?:previous|prior)\s+instructions\b/i,
    /\byou\s+are\s+now\b.{0,80}\b(?:system|administrator|developer)\b/i,
    /\boverride\b.{0,80}\b(?:identity|system (?:prompt|instructions)|tool permissions?)\b/i,
  ];
  if (unsafePatterns.some((pattern) => pattern.test(content))) {
    throw new Error("memory content contains a secret or instruction override");
  }
}

function atomicWrite(filePath: string, content: string): void {
  const parent = dirname(filePath);
  mkdirSync(parent, { recursive: true });
  const tempPath = join(parent, `.${basename(filePath)}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, content, "utf8");
    closeSync(fd);
    fd = undefined;
    renameSync(tempPath, filePath);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(tempPath)) unlinkSync(tempPath);
  }
}

function failure(operation: string, error: unknown): ToolResult {
  return {
    output: `Error ${operation} memory: ${error instanceof Error ? error.message : String(error)}`,
    isError: true,
  };
}
