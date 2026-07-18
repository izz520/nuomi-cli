import { statSync } from "node:fs";
import { relative } from "node:path";
import {
  discoverInstructionState,
  getInstructionCandidatePaths,
  type InstructionSource,
} from "../memory/instructions.js";
import { MemoryManager } from "../memory/manager.js";

export interface RuntimeContext {
  // 指令
  instructions: string;
  // 用户的长期记忆
  userMemoryEntrypoint: string;
  // 项目的长期记忆
  projectMemoryEntrypoint: string;
  // 当前日期
  currentDate: string;
  // MCP上下文
  mcpRuntimeContext: string;
}

export interface RuntimeContextManagerOptions {
  now?: () => Date;
}

export class RuntimeContextManager {
  private cached?: { fingerprint: string; value: RuntimeContext };
  private includeDependencies: string[] = [];
  private mcpRuntimeContext = "";
  private readonly now: () => Date;

  constructor(
    private readonly workDir: string,
    private readonly memoryManager: MemoryManager,
    options: RuntimeContextManagerOptions = {},
  ) {
    //两个readonly自动创建到了this里面
    //储存类创建的时间
    this.now = options.now ?? (() => new Date());
  }

  load(): RuntimeContext {
    //拿到指令文件和长期记忆以及MCP的唯一指纹
    const fingerprint = this.buildFingerprint(this.includeDependencies);
    //如果指纹相同，则直接返回内存中存储的
    if (this.cached?.fingerprint === fingerprint) return this.cached.value;
    //解析配置文件
    const discovery = discoverInstructionState(this.workDir);
    // 引用的所有文件路径
    this.includeDependencies = discovery.dependencies;
    // 内容和路径
    const instructionSources = discovery.sources;
    // 拿到用户级的配置和系统级的配置
    const entrypoints = this.memoryManager.loadEntrypoint();

    const value: RuntimeContext = Object.freeze({
      // 指令的markdown
      instructions: formatInstructions(instructionSources, this.workDir),
      // 用户级别的memory
      userMemoryEntrypoint: entrypoints.user,
      // 项目级别的memory
      projectMemoryEntrypoint: entrypoints.project,
      // 当前时间
      currentDate: formatLocalDate(this.now()),
      // mcp上下文
      mcpRuntimeContext: this.mcpRuntimeContext,
    });
    //把指纹和冻结的全部内容存起来
    this.cached = { fingerprint: this.buildFingerprint(this.includeDependencies), value };
    //返回当前的内容
    return value;
  }

  // 拿到系统提示指令
  buildMessage(): string {
    //拿到所有的指令和记忆
    const context = this.load();
    const sections: string[] = ["Use the following runtime context when relevant."];
    addSection(sections, "Project Instructions", context.instructions);
    addSection(sections, "User Memory Entrypoint", context.userMemoryEntrypoint);
    addSection(sections, "Project Memory Entrypoint", context.projectMemoryEntrypoint);
    addSection(sections, "MCP Runtime Context", context.mcpRuntimeContext);
    addSection(sections, "Current Date", context.currentDate);
    return `<system-reminder>\n${sections.join("\n\n")}\n</system-reminder>`;
  }

  setMcpRuntimeContext(context: string | string[]): void {
    const next = Array.isArray(context) ? context.filter(Boolean).join("\n\n") : context;
    if (next === this.mcpRuntimeContext) return;
    this.mcpRuntimeContext = next;
    this.invalidate();
  }

  invalidate(): void {
    this.cached = undefined;
  }

  //构建指纹
  private buildFingerprint(includeDependencies: string[]): string {
    // 拿到所有的配置文件
    const paths = [
      //拿到AGNETS.md这类配置
      ...getInstructionCandidatePaths(this.workDir),
      // 传递进来的配置
      ...includeDependencies,
      // 读取memory里面的配置，如.nuomi/MEMORY.md
      ...Object.values(this.memoryManager.getEntrypointPaths()),
    ];
    const files = paths.map((filePath) => {
      try {
        //读取文件的信息
        const stat = statSync(filePath);
        //返回路径：文件最后修改的时间：文件的大小（字节）
        return `${filePath}:${stat.mtimeMs}:${stat.size}`;
      } catch {
        //读取失败，则返回路径：缺失
        return `${filePath}:missing`;
      }
    });
    return `${files.join("|")}::mcp=${this.mcpRuntimeContext}::date=${formatLocalDate(this.now())}`;
  }
}

//把路径和内容格式化成markdown
function formatInstructions(sources: InstructionSource[], workDir: string): string {
  return sources.map((source) => {
    //拿到相对路径
    const rel = relative(workDir, source.path);
    //不是..路径的话就名字直接叫路径，不然的话，就是原始路径
    const label = rel && !rel.startsWith("..") ? rel : source.path;
    return `Contents of ${label}:\n\n${source.content.replace(/\n+$/, "")}`;
  }).join("\n\n---\n\n");
}

function addSection(sections: string[], title: string, content: string): void {
  if (content) sections.push(`# ${title}\n${content}`);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
