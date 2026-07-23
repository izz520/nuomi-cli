import { spawn } from "node:child_process";
import type { Tool, ToolResult, ToolContext } from "../types/tools.js";
import { intArg, strArg } from "./utils.js";
import { BashDescription } from "./prompt.js";
import type { Sandbox, SandboxConfig } from "../sandbox/index.js";

const MAX_TIMEOUT = 600;
const MAX_BUFFER = 10 * 1024 * 1024;

// 命令退出码语义映射表：某些命令用非零退出码表示正常结果（如 grep 返回 1 表示未匹配到内容）
// 值为判定"真正出错"的最小退出码阈值
const commandErrorThresholds: Map<string, number> = new Map([
  ["grep", 2],   // exit 1 = 未匹配到内容，不算错误
  ["egrep", 2],
  ["fgrep", 2],
  ["rg", 2],     // ripgrep 同 grep 语义
  ["diff", 2],   // exit 1 = 文件有差异，不算错误
  ["test", 2],   // exit 1 = 条件为假，不算错误
  ["[", 2],      // test 的另一种写法
  ["find", 2],   // exit 1 = 部分成功，不算错误
]);

/**
 * 从命令字符串中提取基础命令名。
 * 管道命令取最后一段（bash 默认返回管道最后一个命令的退出码）。
 */
function extractBaseCmd(command: string): string {
  // 按管道符拆分，取最后一段命令
  const lastSegment = command.split("|").pop()?.trim() ?? command;
  // 提取基础命令名：跳过 env 变量赋值和路径前缀
  const tokens = lastSegment.split(/\s+/);
  for (const token of tokens) {
    // 跳过形如 VAR=value 的环境变量设置
    if (token.includes("=") && !token.startsWith("-")) continue;
    // 去掉路径前缀，只保留命令名
    return token.split("/").pop() ?? token;
  }
  return "";
}

/**
 * 根据命令语义判断退出码是否表示错误。
 */
function interpretExitCode(command: string, exitCode: number): boolean {
  const baseCmd = extractBaseCmd(command);
  const threshold = commandErrorThresholds.get(baseCmd);
  if (threshold !== undefined) {
    return exitCode >= threshold;
  }
  // 默认规则：非零即错误
  return exitCode !== 0;
}

// 特殊命令的退出码语义提示，帮助 LLM 理解非零退出码的含义
const exitCodeHints: Map<string, Map<number, string>> = new Map([
  ["grep", new Map([[1, "no matches found"]])],
  ["egrep", new Map([[1, "no matches found"]])],
  ["fgrep", new Map([[1, "no matches found"]])],
  ["rg", new Map([[1, "no matches found"]])],
  ["diff", new Map([[1, "files differ"]])],
  ["test", new Map([[1, "condition is false"]])],
  ["[", new Map([[1, "condition is false"]])],
  ["find", new Map([[1, "partial success"]])],
]);

/**
 * 为特殊命令的非零退出码返回语义提示，帮助 LLM 理解退出码含义。
 * 如果不是已知的特殊命令或退出码，返回空字符串。
 */
function exitCodeHint(command: string, exitCode: number): string {
  const baseCmd = extractBaseCmd(command);
  const hints = exitCodeHints.get(baseCmd);
  return hints?.get(exitCode) ?? "";
}

export class BashTool implements Tool {
  name = "Bash";
  description = BashDescription;
  category = "command" as const;

  // OS 级沙箱实例及配置，由外部注入
  sandbox: Sandbox | null = null;
  sandboxConfig: SandboxConfig = { allowWrite: [], denyWrite: [], networkEnabled: true };

  schema(): Record<string, unknown> {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
          timeout: { type: "integer", description: "Timeout in seconds (max 600)", default: 120 },
        },
        required: ["command"],
      },
    };
  }

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const command = strArg(args, "command");
    if (!command) {
      return { output: "Error: command is required", isError: true };
    }

    let timeout = intArg(args, "timeout", 120);
    if (timeout > MAX_TIMEOUT) timeout = MAX_TIMEOUT;

    // 沙箱包装：如果沙箱可用，将命令包装在沙箱环境中执行
    let actualCommand = command;
    if (this.sandbox?.available()) {
      actualCommand = this.sandbox.wrap(command, this.sandboxConfig);
    }

    if (ctx.abortSignal?.aborted) {
      return { output: "Command cancelled", isError: true };
    }

    return new Promise<ToolResult>((resolve) => {
      const child = spawn("bash", ["-c", actualCommand], {
        cwd: ctx.workDir,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let bufferedBytes = 0;
      let settled = false;
      let timedOut = false;
      let cancelled = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const finish = (result: ToolResult) => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        ctx.abortSignal?.removeEventListener("abort", handleAbort);
        resolve(result);
      };

      const stop = () => {
        if (child.killed) return;
        if (process.platform !== "win32" && child.pid) {
          try {
            process.kill(-child.pid, "SIGTERM");
            return;
          } catch {
            // Fall back to killing only the shell process.
          }
        }
        child.kill("SIGTERM");
      };

      const handleAbort = () => {
        cancelled = true;
        stop();
      };

      const collect = (target: Buffer[], chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bufferedBytes += buffer.length;
        if (bufferedBytes > MAX_BUFFER) {
          stop();
          finish({ output: `Error: command output exceeded ${MAX_BUFFER} bytes`, isError: true });
          return;
        }
        target.push(buffer);
      };

      child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
      child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
      child.on("error", (error) => {
        finish({ output: `Error executing command: ${error.message}`, isError: true });
      });
      child.on("close", (code) => {
        if (cancelled) {
          finish({ output: "Command cancelled", isError: true });
          return;
        }
        if (timedOut) {
          finish({ output: `Error: command timed out after ${timeout}s`, isError: true });
          return;
        }

        const exitCode = code ?? 0;
        let output = `$ ${command}\n`;
        output += Buffer.concat(stdout).toString("utf-8");
        output += Buffer.concat(stderr).toString("utf-8");

        if (exitCode !== 0) {
          const hint = exitCodeHint(command, exitCode);
          output += hint
            ? `\nExit code ${exitCode} (${hint})`
            : `\nExit code ${exitCode}`;
        }

        finish({ output, isError: interpretExitCode(command, exitCode) });
      });

      timeoutId = setTimeout(() => {
        timedOut = true;
        stop();
      }, timeout * 1000);

      ctx.abortSignal?.addEventListener("abort", handleAbort, { once: true });
    });
  }
}
