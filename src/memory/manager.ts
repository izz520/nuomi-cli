import { existsSync, lstatSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const MAX_ENTRYPOINT_LINES = 200;
const MAX_ENTRYPOINT_BYTES = 25_000;
const MEMORY_INDEX_NAME = "MEMORY.md";

export type MemoryScope = "user" | "project";

export interface MemoryEntrypoints {
  user: string;
  project: string;
}

export interface MemoryManagerOptions {
  userDir?: string;
  projectDir?: string;
}

export class MemoryManager {
  private readonly userDir: string;
  private readonly projectDir: string;
  private readonly workDir: string;

  constructor(workDir: string, options: MemoryManagerOptions = {}) {
    this.workDir = resolve(workDir);
    this.userDir = resolve(options.userDir ?? join(homedir(), ".nuomi", "memory"));
    this.projectDir = resolve(options.projectDir ?? join(this.workDir, ".nuomi", "memory"));
  }

  loadEntrypoint(): MemoryEntrypoints {
    return {
      user: this.readEntrypoint("user"),
      project: this.readEntrypoint("project"),
    };
  }

  private readEntrypoint(scope: MemoryScope): string {
    try {
      return readBoundedEntrypoint(this.resolvePath(scope, MEMORY_INDEX_NAME));
    } catch {
      return "";
    }
  }

  getRoot(scope: MemoryScope): string {
    if (scope === "user") return this.userDir;
    if (scope === "project") return this.projectDir;
    throw new Error("Invalid memory scope; expected 'user' or 'project'");
  }

  getEntrypointPaths(): Record<MemoryScope, string> {
    return {
      user: join(this.userDir, MEMORY_INDEX_NAME),
      project: join(this.projectDir, MEMORY_INDEX_NAME),
    };
  }

  formatDisplayPath(scope: MemoryScope, memoryPath: string): string {
    const target = this.resolvePath(scope, memoryPath);
    const root = this.getRoot(scope);
    const relativePath = relative(root, target).split(sep).join("/");
    const standardUserRoot = resolve(homedir(), ".nuomi", "memory");
    const standardProjectRoot = resolve(this.workDir, ".nuomi", "memory");
    const displayRoot = scope === "user" && root === standardUserRoot
      ? "~/.nuomi/memory"
      : scope === "project" && root === standardProjectRoot
        ? ".nuomi/memory"
        : root;
    return `${displayRoot}/${relativePath}`;
  }

  resolvePath(scope: MemoryScope, memoryPath: string): string {
    const root = this.getRoot(scope);
    if (!memoryPath || memoryPath.includes("\0")) throw new Error("Memory path is required");
    if (isAbsolute(memoryPath)) throw new Error("Memory path must be relative");

    const components = memoryPath.split(/[\\/]+/);
    if (components.some((part) => part === ".." || part === "")) {
      throw new Error("Memory path traversal is not allowed");
    }
    if (components.at(-1)?.toLowerCase().endsWith(".md") !== true) {
      throw new Error("Memory path must reference a .md file");
    }

    const target = resolve(root, ...components);
    const rel = relative(root, target);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error("Memory path escapes its scope");
    }

    let current = root;
    rejectSymlink(current);
    for (const component of components) {
      current = join(current, component);
      rejectSymlink(current);
    }
    return target;
  }

  clear(): void {
    for (const dir of [this.userDir, this.projectDir]) {
      if (!existsSync(dir)) continue;
      rejectSymlink(dir);
      for (const file of readdirSync(dir).filter((name) => name.endsWith(".md"))) {
        try {
          unlinkSync(join(dir, file));
        } catch {
          // Best-effort cleanup.
        }
      }
    }
  }
}

function rejectSymlink(filePath: string): void {
  try {
    if (lstatSync(filePath).isSymbolicLink()) {
      throw new Error(`Memory path contains a symbolic link: ${filePath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

//读取内容
function readBoundedEntrypoint(filePath: string): string {
  let content: string;
  try {
    //读取内容
    content = readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
  // 只取内容的前200行的内容
  const lineBounded = content.split("\n").slice(0, MAX_ENTRYPOINT_LINES).join("\n");
  //如果200行的内容小于25000字节的限制，则直接返回
  if (Buffer.byteLength(lineBounded, "utf8") <= MAX_ENTRYPOINT_BYTES) return lineBounded;
  // 
  let result = "";
  let bytes = 0;
  // 循环行，只取250000字节的内容返回
  for (const character of lineBounded) {
    // 拿到每一行的字节大小
    const characterBytes = Buffer.byteLength(character, "utf8");
    // 如果说大于了25000的字符，就不要了
    if (bytes + characterBytes > MAX_ENTRYPOINT_BYTES) break;

    result += character;
    bytes += characterBytes;
  }
  return result;
}
