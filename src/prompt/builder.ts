// 来源：公众号@小林coding
// 后端八股网站：xiaolincoding.com
// Agent网站：xiaolinnote.com
// 简历模版：jianli.xiaolinnote.com

import { execSync } from "node:child_process";
import { platform, arch } from "node:os";
import type { Section, EnvironmentContext } from "./sections.js";
import {
  identitySection,
  systemSection,
  doingTasksSection,
  executingActionsSection,
  usingToolsSection,
  toneStyleSection,
  outputEfficiencySection,
  environmentSection,
} from "./sections.js";

export class PromptBuilder {
  private sections: Section[] = [];

  add(s: Section): this {
    this.sections.push(s);
    return this;
  }

  build(): string {
    const sorted = [...this.sections].sort((a, b) => a.priority - b.priority);
    return sorted
      .map((s) => s.content.trim())
      .filter(Boolean)
      .join("\n\n");
  }
}
//获取当前目录和一些系统信息
export function detectEnvironment(workDir: string): EnvironmentContext {
  const env: EnvironmentContext = {
    //当前的工作目录
    workDir,
    //当前的系统
    os: platform(),
    //CPU架构
    arch: arch(),
    //Shell命令
    shell: process.env.SHELL ?? "bash",
    //默认认为当前目录不是 Git 仓库
    isGitRepo: false,
    //当前 Git 分支，默认空字符串
    gitBranch: "",
    //模型名，当前这里还没填，默认空字符串
    model: "",
    //当前日期
    date: new Date().toISOString().split("T")[0],
  };

  try {
    //判断工作目录是否在git仓库
    /**
     * 执行git rev-parse --is-inside-work-tree
     * 如果是git仓库，则会返回true
     */
    const result = execSync("git rev-parse --is-inside-work-tree", {
      cwd: workDir,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    }).trim();
    if (result === "true") {
      //重设isGitRepo为true
      env.isGitRepo = true;
      //拿到当前git的分支
      env.gitBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: workDir,
        stdio: ["pipe", "pipe", "pipe"],
        encoding: "utf-8",
      }).trim();
    }
  } catch {
    // not a git repo
  }

  return env;
}

export interface BuildOptions {
  skillSection?: string;
}

export function buildSystemPrompt(
  env: EnvironmentContext,
  opts: BuildOptions = {}
): string {
  const b = new PromptBuilder();
  b.add(identitySection());
  b.add(systemSection());
  b.add(doingTasksSection());
  b.add(executingActionsSection());
  b.add(usingToolsSection());
  b.add(toneStyleSection());
  b.add(outputEfficiencySection());
  b.add(environmentSection(env));

  if (opts.skillSection) {
    b.add({ name: "Skills", priority: 90, content: opts.skillSection });
  }

  return b.build();
}
