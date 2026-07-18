import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve, isAbsolute, relative } from "node:path";
import { homedir } from "node:os";

/** @include 最大递归深度，防止无限嵌套 */
const MAX_INCLUDE_DEPTH = 5;

/** 已加载的指令文件 */
export interface InstructionSource {
  path: string;
  content: string;
}

export interface InstructionDiscovery {
  sources: InstructionSource[];
  /** Include targets found while expanding sources, including missing targets. */
  dependencies: string[];
}

/**
 * 发现并拼接所有项目和用户级指令文件。
 *
 * 发现顺序（越靠后优先级越高，模型注意力优先关注后面的内容）：
 *  1. 用户全局: ~/.mewcode/MEWCODE.md, ~/.mewcode/AGENTS.md
 *  2. 项目: 从 git root 到 workDir 路径上每个目录的 MEWCODE.md 和 AGENTS.md
 *  3. workDir/.mewcode/INSTRUCTIONS.md（兼容旧格式）
 *  4. workDir/MEWCODE.local.md（本地私有覆盖）
 *
 * 支持 @include 指令：
 *  - @./relative/path, @~/home/path, @/absolute/path
 *  - 相对于包含文件所在目录解析
 *  - 在 fenced code block 内忽略
 *  - 循环检测（同一绝对路径不会被包含两次）
 */
export function loadInstructions(workDir: string): string {
  // console.log("🚀 ~ loadInstructions ~ workDir:", workDir)
  //拿到全部解析引用完的内容
  const sources = discoverInstructions(workDir);
  //如果为空，则返回空
  if (sources.length === 0) return "";
  const parts: string[] = [];
  // 循环这个内容
  for (const s of sources) {
    // 尽量用相对路径作为标签，更易读
    let label = s.path;
    try {
      //相对于当前工作目录，s所在的位置
      const rel = relative(workDir, s.path);
      // console.log("🚀 ~ loadInstructions ~ workDir:", workDir)
      // console.log("🚀 ~ loadInstructions ~ rel:", rel)
      //不是..开头的，就把lael设置成路径
      if (!rel.startsWith("..")) label = rel;
    } catch {
      // 保持绝对路径
    }
    parts.push(`Contents of ${label}:\n\n${s.content.replace(/\n+$/, "")}`);
  }
  return parts.join("\n\n---\n\n");
}

/**
 * 按优先级顺序返回所有已加载的指令源文件。
 * 最低优先级在前（用户全局），最高在后（本地覆盖）。
 */
export function discoverInstructions(workDir: string): InstructionSource[] {
  return discoverInstructionState(workDir).sources;
}

/** Conventional paths can be fingerprinted without reading instruction contents. */
//拿到记忆的路径，比如AGENTS.md这类的路径
export function getInstructionCandidatePaths(workDir: string): string[] {
  const candidates: string[] = [];
  try {
    const home = homedir();
    candidates.push(join(home, ".nuomi", "NUOMI.md"), join(home, ".nuomi", "AGENTS.md"));
  } catch {
    // $HOME unavailable
  }
  for (const dir of projectInstructionDirs(workDir)) {
    candidates.push(join(dir, "NUOMI.md"), join(dir, "AGENTS.md"));
  }
  candidates.push(join(workDir, ".nuomi", "INSTRUCTIONS.md"));
  candidates.push(join(workDir, "NUOMI.local.md"));
  return candidates.map((candidate) => resolve(candidate));
}

/** Discover content plus include dependencies for future stat-only cache checks. */
export function discoverInstructionState(workDir: string): InstructionDiscovery {
  const sources: InstructionSource[] = [];//path和内容
  const seen = new Set<string>();
  const dependencies = new Set<string>();
  //拿到当前工作目录的配置路径和系统配置路径
  for (const candidate of getInstructionCandidatePaths(workDir)) {
    addSource(sources, seen, dependencies, candidate);
  }
  return { sources, dependencies: [...dependencies] };
}

/** 尝试读取一个指令文件并添加到列表，支持 @include 展开 */
function addSource(
  out: InstructionSource[],
  seen: Set<string>,
  dependencies: Set<string>,
  filePath: string
): void {
  let abs: string;
  try {
    //获取绝对路径
    abs = resolve(filePath);
  } catch {
    return;
  }
  // 如果seen里面已经存在，则跳过了
  if (seen.has(abs)) return;
  // 如果路径不存在也返回
  if (!existsSync(abs)) return;
  // console.log("🚀 ~ addSource ~ abs:", abs)

  let data: string;
  try {
    // 读取文件内容
    data = readFileSync(abs, "utf-8");
  } catch {
    return;
  }
  //把路径存起来
  seen.add(abs);
  //把内容，检索配置文件的路径，标记函数，递归次数
  const content = expandIncludes(data, dirname(abs), seen, dependencies, 0);
  out.push({ path: abs, content });
}

/**
 * 递归展开 @include 指令。
 * 在 fenced code block 内的 @ 行不做处理。
 * 同一绝对路径不会被包含两次（cycle-safe）。
 */
function expandIncludes(
  //内容
  content: string,
  //配置文件所在目录
  baseDir: string,
  //存储标记
  seen: Set<string>,
  dependencies: Set<string>,
  // 递归次数
  depth: number
): string {
  // console.log("baseDir", baseDir);

  //递归层数为5,超出则直接返回原内容
  if (depth > MAX_INCLUDE_DEPTH) return content;
  //把内容根据换行符进行切割
  const lines = content.split("\n");
  const out: string[] = [];
  let inCode = false;
  // 循环内容
  for (const line of lines) {
    // 得到去除空格的内容
    const trimmed = line.trim();

    // 检测 fenced code block 边界
    if (trimmed.startsWith("```")) {
      inCode = !inCode;
      out.push(line);
      continue;
    }
    // 代码块以外的内容进入，看是否有引用
    if (!inCode) {
      // 拿到引用路径，如果不是引用，则返回空
      const includePath = parseInclude(trimmed);
      // console.log("🚀 ~ expandIncludes ~ includePath:", includePath)
      if (includePath) {
        // 解析拿到引用文件的路径
        const resolved = resolveInclude(includePath, baseDir);
        if (resolved) {
          let abs: string;
          try {
            abs = resolve(resolved);
            // console.log("🚀 ~ expandIncludes ~ abs:", abs)
          } catch {
            //转换路径失败的话，就把原内容存起来
            out.push(line);
            continue;
          }
          dependencies.add(abs);
          if (!seen.has(abs)) {
            //没有读取过这个文件
            try {
              //读取内容
              const data = readFileSync(abs, "utf-8");
              //把这个路径标记成读取过
              seen.add(abs);
              //添加一个路径标记
              out.push(`<!-- included from ${includePath} -->`);
              //调用自己进行递归
              out.push(expandIncludes(data, dirname(abs), seen, dependencies, depth + 1));
              continue;
            } catch {
              // 读取失败，保留原始行让用户看到
            }
          }
        }
        // 无法解析或已包含，保留原始行
      }
    }
    // 代码块内的内容或者是非引用内容，直接存起来
    out.push(line);
  }

  return out.join("\n");
}

/**
 * 解析 @include 行：@./path, @~/path, @/abs/path。
 * 其他 @-token（如 @username）会被忽略以避免误识别。
 */
function parseInclude(trimmed: string): string {
  // 必须以 @ 开头，但 @@ 是转义不处理
  //不是引用，则返回空
  if (!trimmed.startsWith("@") || trimmed.startsWith("@@")) return "";
  // 是引用，移除@富豪
  const rest = trimmed.slice(1);
  // 如果不存在，返回空
  if (!rest) return "";
  // 不能包含空格或制表符（排除 @username 等情况）
  if (/[\s\t]/.test(rest)) return "";

  // 只接受相对路径、~/路径、绝对路径
  if (
    rest.startsWith("./") ||
    rest.startsWith("../") ||
    rest.startsWith("~/") ||
    rest.startsWith("/")
  ) {
    return rest;
  }
  return "";
}

/** 将 include 路径解析为绝对路径 */
function resolveInclude(p: string, baseDir: string): string {
  if (p.startsWith("~/")) {
    try {
      return join(homedir(), p.slice(2));
    } catch {
      return "";
    }
  }
  // console.log("isAbsolute(p)", isAbsolute(p));

  if (isAbsolute(p)) return p;
  return join(baseDir, p);
}

/**
 * 返回从 git root 到 workDir 的目录列表。
 * 如果 workDir 不在 git 仓库内，只返回 [workDir]。
 */
function projectInstructionDirs(workDir: string): string[] {
  let abs: string;
  try {
    abs = resolve(workDir);
  } catch {
    return [workDir];
  }

  const root = findGitRoot(abs);
  if (!root) return [abs];

  // 从 abs 向上收集到 root
  const dirs: string[] = [];
  let cur = abs;
  while (true) {
    dirs.unshift(cur);
    if (cur === root) break;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return dirs;
}

/** 向上查找 .git 目录以确定 git 仓库根 */
function findGitRoot(start: string): string {
  let cur = start;
  while (true) {
    try {
      const gitPath = join(cur, ".git");
      if (existsSync(gitPath)) return cur;
    } catch {
      // ignore
    }
    const parent = dirname(cur);
    if (parent === cur) return "";
    cur = parent;
  }
}
