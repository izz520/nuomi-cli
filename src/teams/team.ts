import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { FileMailbox } from "./file-mailbox.js";
import { detectBackend } from "./backend.js";
import type { TeammateUIState } from "./progress.js";
import { createProgress, recordToolUse, recordTokens } from "./progress.js";
import { randomVerb } from "./verbs.js";
import type { MessageManager } from "../messageManager/message.js";
import { saveTranscript } from "./transcript.js";

export type TeamMode = "in-process" | "tmux" | "iterm";

export type TeamIdentifierKind = "team" | "member";

const TEAM_IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Validate identifiers before they are used in mailbox/worktree paths.
 * Keeping one strict grammar also makes identities safe to serialize in
 * notifications and command arguments.
 */
//断言有效的团队标识符
export function assertValidTeamIdentifier(
  value: string,
  kind: TeamIdentifierKind,
): void {
  if (!TEAM_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(
      `Invalid ${kind} name '${value}': expected 1-64 characters using only A-Z, a-z, 0-9, '_' or '-'`,
    );
  }
}

// Callback that receives agent events during execution. The team layer uses
// this to update TeammateUIState without depending on the agent/LLM layer.
export type AgentEventCallback = (event: {
  type: string;
  toolName?: string;
  args?: Record<string, unknown>;
  usage?: { inputTokens: number; outputTokens: number };
  text?: string;
}) => void;

/** Stable runtime identity assigned by the team, never by model tool input. */
export interface TeamIdentity {
  teamName: string;
  memberName: string;
}

export interface TeamAgentWorktreeMetadata {
  workDir: string;
  branch?: string;
  [key: string]: unknown;
}

/**
 * A teammate session owns the long-lived model conversation and execution
 * resources for one member. Team calls run repeatedly on the same instance.
 */
export interface TeamAgentSession {
  readonly signal: AbortSignal;
  run(prompt: string, onEvent?: AgentEventCallback): Promise<string>;
  stop(): Promise<void> | void;
  messageManager?: MessageManager;
  worktree?: TeamAgentWorktreeMetadata;
}

export type CreateTeamAgentSession = (
  identity: TeamIdentity,
) => TeamAgentSession | Promise<TeamAgentSession>;

export interface Member {
  name: string;
  active: boolean;
  cancel?: () => void;
  mailbox: FileMailbox;
  uiState?: TeammateUIState;
  /** 可选：队友的对话管理器，设置后退出时会持久化 transcript。 */
  messageManager?: MessageManager;
  session?: TeamAgentSession;
  sessionPromise?: Promise<TeamAgentSession>;
  completion?: Promise<void>;
  stopPromise?: Promise<void>;
}

// Runs a teammate's task and returns its final output. Injected so the team
// layer stays decoupled from the LLM/agent layer (and is unit-testable).
// The optional onEvent callback lets the team layer observe agent events
// (tool_use, usage) without coupling to the Agent/LLM types directly.
export type RunAgent = (task: string, onEvent?: AgentEventCallback) => Promise<string>;

/** Adapt the legacy one-shot callback used by SpawnTeammateTool. */
export function createSessionFromRunAgent(
  runAgent: RunAgent,
): CreateTeamAgentSession {
  return () => {
    const controller = new AbortController();
    return {
      signal: controller.signal,
      run: runAgent,
      stop: () => controller.abort(),
    };
  };
}

export class Team {
  name: string;
  mode: TeamMode;
  members = new Map<string, Member>();
  leadMailbox: FileMailbox;
  private mailboxDir: string;
  private workDir: string;

  constructor(name: string, mode: TeamMode, workDir: string) {
    this.name = name;
    this.mode = mode;
    this.workDir = workDir;
    this.mailboxDir = join(workDir, ".nuomi", "teams", name);
    mkdirSync(this.mailboxDir, { recursive: true });
    this.leadMailbox = new FileMailbox(this.mailboxDir, "lead");
  }

  addMember(name: string): Member {
    //判断名字是否有效
    assertValidTeamIdentifier(name, "member");
    if (this.members.has(name)) {
      //这个名称在成员里面是否存在，存在则报错
      throw new Error(`Member '${name}' already exists in team '${this.name}'`);
    }
    //创建一个根据team目录和成员名称创建一个专属的邮箱管理
    const mailbox = new FileMailbox(this.mailboxDir, name);
    // 构建member对象
    const member: Member = { name, active: false, mailbox };
    // 把当前member存起来
    this.members.set(name, member);
    //返回member对象
    return member;
  }

  // 空闲轮询间隔（毫秒），队友完成一轮后轮询信箱等待新消息
  static readonly IDLE_POLL_INTERVAL_MS = 500;
  // 关机前缀：lead 写入此前缀的消息通知队友退出
  static readonly SHUTDOWN_PREFIX = "[shutdown]";

  /**
   * 启动 in-process 队友：在后台运行 agent 主循环，完成后发送 idle 通知，
   * 然后轮询信箱等待新任务。收到 shutdown 消息或被 cancel 时退出循环。
   * 对齐 Go RunInProcessTeammate 的 idle-poll-continue 模式。
   */
  spawnTeammate(
    name: string,
    task: string,
    createSession: CreateTeamAgentSession,
  ): void {
    //判断名称是否有效
    assertValidTeamIdentifier(name, "member");
    //把当前sub agent添加到team成员中
    const member = this.addMember(name);
    //把当前的成员的active设置为true
    member.active = true;

    // 为进度追踪创建 UI 状态
    const uiState: TeammateUIState = {
      name,
      teamName: this.name,
      status: "running",
      progress: createProgress(),
      startTime: Date.now(),
      spinnerVerb: randomVerb(),
    };
    member.uiState = uiState;

    // agent 事件回调：更新进度
    const onEvent: AgentEventCallback = (event) => {
      switch (event.type) {
        case "tool_use":
          if (event.toolName && event.args) {
            recordToolUse(uiState.progress, event.toolName, event.args);
          }
          break;
        case "usage":
          if (event.usage) {
            recordTokens(
              uiState.progress,
              event.usage.inputTokens,
              event.usage.outputTokens,
            );
          }
          break;
        case "stream_text":
          if (event.text) {
            uiState.lastMessage = event.text;
          }
          break;
      }
    };

    const identity: TeamIdentity = {
      teamName: this.name,
      memberName: name,
    };
    const sessionPromise = Promise.resolve().then(() => createSession(identity));
    member.sessionPromise = sessionPromise;

    // 主循环：创建一次 session → 多轮复用 → idle 轮询。
    member.completion = (async () => {
      let nextPrompt = task;
      let idleReason = "available";
      try {
        // 等待createSession(identity)执行完成拿到结果
        const session = await sessionPromise;
        //把session存起来
        member.session = session;
        //消息管理器也存起来
        member.messageManager = session.messageManager;
        if (!member.active) {
          //如果active状态为false，则停止
          await this.stopSession(member);
          return;
        }

        while (member.active) {
          // 执行一轮 agent
          uiState.status = "running";
          //发送消息给agent
          const result = await session.run(nextPrompt, onEvent);
          // stop/delete may happen while run() is pending. A late result must
          // never publish completion or overwrite the stopped terminal state.
          if (!member.active) break;
          //如果返回的消息大于200字符，就切断
          uiState.lastMessage = result.length > 200 ? result.slice(0, 200) + "..." : result;
          //发送消息，实际上就是写入文件里面
          await this.leadMailbox.send(name, JSON.stringify({
            type: "task_result",
            status: "completed",
            team: this.name,
            member: name,
            result,
            ...(session.worktree ? { worktree: session.worktree } : {}),
          }));
          //把ui状态设置为闲置
          uiState.status = "idle";
          // 再把当前agent成员闲置的状态发给leader
          await this.leadMailbox.send(
            name,
            `[idle] ${name} (reason: ${idleReason})`
          );
          idleReason = "available";

          // 轮询信箱等待新消息或 shutdown
          const pollResult = await this.waitForNextPromptOrShutdown(member);
          //如果有下线或者active为false
          if (pollResult.shutdown || !member.active) {
            //下线了，且member.active为true
            if (pollResult.shutdown && member.active) {
              //则设置成员状态为false
              member.active = false;
              // 停止session
              await this.stopSession(member);
              // 更新UI状态为完成
              uiState.status = "completed";
            }
            break;
          }
          // 不然的话更新nextPrompt
          nextPrompt = pollResult.prompt;
        }

        if (member.active) {
          uiState.status = "completed";
        }
      } catch (e) {
        if (!member.active || uiState.status === "stopped") return;
        uiState.status = "failed";
        const error = (e as Error).message.slice(0, 500);
        uiState.lastMessage = error;
        await this.leadMailbox.send(name, JSON.stringify({
          type: "task_result",
          status: "failed",
          team: this.name,
          member: name,
          error,
        }));
        await this.leadMailbox.send(name, `[idle] ${name} (reason: failed)`);
      } finally {
        member.active = false;
        try {
          await this.stopSession(member);
        } catch {
          // The terminal state and notification are more important than a
          // best-effort resource cleanup failure.
        }
        // 队友退出时持久化对话记录，用于调试
        if (member.messageManager) {
          try {
            saveTranscript(this.workDir, this.name, name, member.messageManager);
          } catch {
            // best-effort：持久化失败不影响正常退出
          }
        }
      }
    })();
  }

  private async stopSession(member: Member): Promise<void> {
    if (member.stopPromise) {
      await member.stopPromise;
      return;
    }
    member.stopPromise = (async () => {
      try {
        const session = member.session ?? await member.sessionPromise;
        await session?.stop();
      } catch {
        // Session construction/cleanup failures are reported by the main
        // teammate loop. stop/delete remain idempotent and best-effort.
      } finally {
        member.cancel?.();
      }
    })();
    await member.stopPromise;
  }

  /**
   * 阻塞等待直到队友信箱有新消息。返回拼接后的 prompt 或 shutdown 标志。
   */
  private async waitForNextPromptOrShutdown(
    member: Member
  ): Promise<{ prompt: string; shutdown: boolean }> {
    while (member.active) {
      await new Promise((r) => setTimeout(r, Team.IDLE_POLL_INTERVAL_MS));
      //读取最新的消息数组
      const msgs = member.mailbox.receiveSync();
      // 等于0表示没有消息，跳过
      if (msgs.length === 0) continue;

      // 检查是否有 shutdown 请求
      const hasShutdown = msgs.some((m) =>
        m.text.trimStart().startsWith(Team.SHUTDOWN_PREFIX)
      );
      // 有下线通知的话，就结束
      if (hasShutdown) return { prompt: "", shutdown: true };

      // 拼接所有消息作为下一轮的 user prompt
      const prompt = msgs
        .map((m) => `From ${m.from}: ${m.text}`)
        .join("\n\n");
      return { prompt: `You have new messages from your team:\n\n${prompt}`, shutdown: false };
    }
    return { prompt: "", shutdown: true };
  }

  getMember(name: string): Member | undefined {
    return this.members.get(name);
  }

  async sendMessage(from: string, to: string, content: string): Promise<void> {
    if (to === "lead") {
      await this.leadMailbox.send(from, content);
      return;
    }
    const member = this.members.get(to);
    if (!member) {
      throw new Error(`Member '${to}' not found in team '${this.name}'`);
    }
    await member.mailbox.send(from, content);
  }

  async stopMember(name: string): Promise<void> {
    const member = this.members.get(name);
    if (member) {
      member.active = false;
      if (
        member.uiState
        && member.uiState.status !== "completed"
        && member.uiState.status !== "failed"
      ) {
        member.uiState.status = "stopped";
      }
      await this.stopSession(member);
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      [...this.members.keys()].map((name) => this.stopMember(name)),
    );
  }

  listMembers(): Member[] {
    return [...this.members.values()];
  }

  getTeammateStates(): TeammateUIState[] {
    return this.listMembers()
      .filter((m) => m.uiState)
      .map((m) => m.uiState!);
  }
}

export class TeamManager {
  private teams = new Map<string, Team>();
  private workDir: string;

  constructor(workDir: string) {
    this.workDir = workDir;
  }

  create(name: string, mode: TeamMode = detectBackend()): Team {
    assertValidTeamIdentifier(name, "team");
    if (this.teams.has(name)) {
      throw new Error(`Team '${name}' already exists`);
    }
    const team = new Team(name, mode, this.workDir);
    this.teams.set(name, team);
    return team;
  }

  get(name: string): Team | undefined {
    return this.teams.get(name);
  }

  list(): Team[] {
    return [...this.teams.values()];
  }

  async delete(name: string): Promise<void> {
    const team = this.teams.get(name);
    if (team) {
      await team.stopAll();
      this.teams.delete(name);
    }
  }

  getAllTeammateStates(): TeammateUIState[] {
    return this.list().flatMap((t) => t.getTeammateStates());
  }

  /**
   * 读取所有团队 lead 信箱中的未读消息，以 XML 标签格式返回。
   * 对齐 Go DrainLeadMailbox 的 <team-notification> 格式，
   * 让模型能结构化解析团队通知。
   */
  drainLeads(): string[] {
    const out: string[] = [];
    for (const team of this.teams.values()) {
      const msgs = team.leadMailbox.receiveSync();
      if (msgs.length === 0) continue;
      const lines: string[] = [];
      lines.push(`<team-notification team="${team.name}">`);
      for (const msg of msgs) {
        lines.push(`from=${msg.from}: ${msg.text}`);
      }
      lines.push("</team-notification>");
      out.push(lines.join("\n"));
    }
    return out;
  }
}
