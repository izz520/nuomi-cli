// 来源：公众号@小林coding
// 后端八股网站：xiaolincoding.com
// Agent网站：xiaolinnote.com
// 简历模版：jianli.xiaolinnote.com

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { load } from "js-yaml";
import type { Skill, SkillMeta } from "../types/skill.js";
import { loadBuiltins } from "./builtins.js";

/** 内部存储的 skill 附带源文件路径和加载时间戳，用于热重载 */
interface SkillEntry {
  skill: Skill;
  /** SKILL.md 的绝对路径，用于热重载时重新读取 */
  filePath: string;
  /** 上次加载时文件的修改时间（ms），0 表示内嵌 skill 无需重载 */
  loadedMtimeMs: number;
}

export class SkillManager {
  private entries = new Map<string, SkillEntry>();
  private workDir = "";
  private dirModTimes = new Map<string, number>();

  load(workDir: string): void {
    this.workDir = workDir;
    // 三层加载，后面的覆盖前面的同名 skill：
    // Tier 1: 内置 skill（当前为空）
    for (const skill of loadBuiltins()) {
      this.entries.set(skill.meta.name, {
        skill,
        filePath: "",
        loadedMtimeMs: 0,
      });
    }

    // Tier 2: 用户全局 ~/.nuomi/skills/
    // Tier 3: 项目级 $workDir/.nuomi/skills/（最高优先级）
    const dirs = [
      join(homedir(), ".nuomi", "skills"),
      join(workDir, ".nuomi", "skills"),
    ];
    // 循环把用户和项目的skill加载进entries中
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      this.scanDirectory(dir);
    }
    //保存最后的修改时间
    this.snapshotDirModTimes();
  }

  /**
   * 检查 skill 目录的 modtime 是否变化（新增或删除了 skill）。
   * 已有 skill 的文件编辑由 get() 的按需重读处理。
   */
  needsReload(): boolean {
    for (const [dir, recorded] of this.dirModTimes) {
      try {
        const current = statSync(dir).mtimeMs;
        if (current !== recorded) return true;
      } catch {
        if (recorded !== 0) return true;
      }
    }
    const dirs = this.skillDirPaths();
    for (const dir of dirs) {
      if (!this.dirModTimes.has(dir)) {
        try {
          statSync(dir);
          return true;
        } catch {
          // 目录仍不存在
        }
      }
    }
    return false;
  }

  reload(): void {
    this.entries.clear();
    this.load(this.workDir);
  }

  private snapshotDirModTimes(): void {
    this.dirModTimes.clear();
    //拿到当前的skill读取目录
    for (const dir of this.skillDirPaths()) {
      try {
        // 保存目录的最后修改时间
        this.dirModTimes.set(dir, statSync(dir).mtimeMs);
      } catch {
        this.dirModTimes.set(dir, 0);
      }
    }
  }

  private skillDirPaths(): string[] {
    return [
      join(homedir(), ".nuomi", "skills"),
      ...(this.workDir ? [join(this.workDir, ".nuomi", "skills")] : []),
    ];
  }
  // 扫描文件夹
  private scanDirectory(dir: string): void {
    let dirEntries: string[];
    try {
      // 读取目录的全部文件夹或者文件的名称，eg：README.md、test.txt、file-dir
      dirEntries = readdirSync(dir);
      console.log("🚀 ~ SkillManager ~ scanDirectory ~ dirEntries:", dirEntries)
    } catch {
      return;
    }
    // 循环目录里面的文件夹或者文件
    for (const entry of dirEntries) {
      // 拼接完整路径
      ///project/.nuomi/skills/boss
      const fullPath = join(dir, entry);
      // 拿到路径下文件的信息，是文件夹还是文件
      const stat = statSync(fullPath);
      // 如果是文件夹，则再补充一个SKILL.md
      if (stat.isDirectory()) {
        //project/.nuomi/skills/boss/SKILL.md
        const skillFile = join(fullPath, "SKILL.md");
        if (existsSync(skillFile)) {
          //将Skill根据名字，SKill实体的形式存储到entries里面
          this.loadSkill(skillFile, fullPath, true);
        }
      } else if (entry.endsWith(".md") && entry !== "SKILL.md") {
        //单SKILL的markdown也读取
        this.loadSkill(fullPath, dir, false);
      }
    }
  }

  /**
   * 
   * @param filePath SKILL.md的路径
   * @param sourceDir 文件夹的路径
   * @param isDirectory 是否是文件夹
   * @returns void
   */
  private loadSkill(filePath: string, sourceDir: string, isDirectory: boolean): void {
    //
    try {
      //读取这个SKILL.md
      const raw = readFileSync(filePath, "utf-8");
      // 解析SKILL.md
      const parsed = parseSkillFile(raw);
      // 如果解析之后不存在，则返回
      if (!parsed) return;
      // 拿到Skill格式化后的对象
      const skill: Skill = {
        meta: parsed.meta,
        body: parsed.body,
        sourceDir,
        isDirectory,
      };

      // 记录文件修改时间，用于后续热重载检测
      let mtimeMs = 0;
      try {
        // 记录文件最后的修改时间
        mtimeMs = statSync(filePath).mtimeMs;
      } catch {
        // 无法获取时间戳时不影响加载
      }
      // 把Skill根据名字，存起来
      this.entries.set(skill.meta.name, {
        skill,
        filePath,
        loadedMtimeMs: mtimeMs,
      });
    } catch {
      // 跳过无效 skill
    }
  }

  list(): SkillMeta[] {
    return [...this.entries.values()].map((e) => e.skill.meta);
  }

  /**
   * 获取 skill，支持热重载：如果磁盘文件已被修改，自动重新读取。
   * 对齐 Go 版 GetFull：每次调用时重新读取 body（热重载），
   * 读取失败时保留已缓存的 body。
   */
  get(name: string): Skill | undefined {
    const entry = this.entries.get(name);
    if (!entry) return undefined;

    // 尝试热重载：检查文件是否已修改
    if (entry.filePath && entry.loadedMtimeMs > 0) {
      try {
        const currentMtime = statSync(entry.filePath).mtimeMs;
        if (currentMtime > entry.loadedMtimeMs) {
          // 文件已修改，重新读取
          const raw = readFileSync(entry.filePath, "utf-8");
          // 拿到Skill格式化后的对象
          const parsed = parseSkillFile(raw);
          if (parsed) {
            entry.skill = {
              meta: parsed.meta,
              body: parsed.body,
              sourceDir: entry.skill.sourceDir,
              isDirectory: entry.skill.isDirectory,
            };
            entry.loadedMtimeMs = currentMtime;
          }
          // 解析失败时保留已缓存版本（与 Go 行为一致）
        }
      } catch {
        // 读取失败时保留已缓存版本
      }
    }

    return entry.skill;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }
}

// 解析SKILL的Yarml Formatter
function parseSkillFile(
  content: string
): { meta: SkillMeta; body: string } | null {
  // 如果开头不是---开头，则返回空，因为这不是一个正规规范的SKILL
  if (!content.startsWith("---")) return null;
  // 找到---的结束符的位置
  const endIdx = content.indexOf("---", 3);
  // 如果没有结束符，则也返回null
  if (endIdx === -1) return null;
  // 拿到----包裹的头信息
  const frontmatter = content.slice(3, endIdx).trim();
  // 拿到---以后的SKILL内容
  const body = content.slice(endIdx + 3).trim();

  try {
    // 把markdown格式的转换成对象
    const raw = load(frontmatter) as Record<string, unknown> | null;
    // 如果skill的名字不存在，则返回空
    if (!raw?.name) return null;

    return {
      meta: {
        name: raw.name as string,
        description: (raw.description as string) ?? "",
        mode: (raw.mode as "inline" | "fork") ?? "inline",
        model: raw.model as string | undefined,
        forkContext: raw.fork_context as "full" | "recent" | "none" | undefined,
      },
      body,
    };
  } catch {
    return null;
  }
}
