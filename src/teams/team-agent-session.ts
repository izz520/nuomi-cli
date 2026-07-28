import createClient from "../client/create.js";
import { Agent } from "../client/agent.js";
import { resolveModelId } from "../client/model-resolver.js";
import { MessageManager } from "../messageManager/message.js";
import { PermissionChecker } from "../premisson/checker.js";
import {
  DEFAULT_SUBAGENT_MAX_TURNS,
  SubAgentRunError,
  buildSubAgentSystemPrompt,
} from "../subAgent/spawn.js";
import { filterToolsForAgent } from "../tools/tool-filter.js";
import type { ToolsManger } from "../tools/register.js";
import type { ProviderConfig } from "../types/provider.js";
import type { SubAgent } from "../types/subAgent.js";
import {
  buildWorktreeNotice,
  createAgentWorktree,
  inspectWorktree,
  removeAgentWorktree,
  type WorktreeResult,
} from "../worktree/worktree.js";
import { SendMessageTool } from "./tools.js";
import type {
  AgentEventCallback,
  CreateTeamAgentSession,
  TeamAgentSession,
  TeamAgentWorktreeMetadata,
  TeamIdentity,
  TeamManager,
} from "./team.js";

type ClientFactory = typeof createClient;

export interface TeamAgentSessionFactoryOptions {
  subAgent: SubAgent;
  provider: ProviderConfig;
  parentToolManager: ToolsManger;
  teamManager: TeamManager;
  workDir: string;
  modelOverride?: string;
  clientFactory?: ClientFactory;
  worktreeFactory?: (slug: string, gitRoot?: string) => WorktreeResult;
  worktreeInspector?: typeof inspectWorktree;
  worktreeRemover?: typeof removeAgentWorktree;
}

export interface CreateTeamAgentSessionOptions
  extends TeamAgentSessionFactoryOptions {
  identity: TeamIdentity;
}

/** Create one persistent session directly for a concrete teammate. */
export function createTeamAgentSession(
  options: CreateTeamAgentSessionOptions,
): PersistentTeamAgentSession {
  const { identity, ...sessionOptions } = options;
  return PersistentTeamAgentSession.create(identity, sessionOptions);
}

/**
 * Creates one long-lived model runtime per teammate. The returned factory is
 * useful when the same runtime configuration creates multiple identities.
 */
export function createTeamAgentSessionFactory(
  options: TeamAgentSessionFactoryOptions,
): CreateTeamAgentSession {
  return (identity) => createTeamAgentSession({ ...options, identity });
}

export class PersistentTeamAgentSession implements TeamAgentSession {
  readonly messageManager: MessageManager;
  readonly signal: AbortSignal;
  worktree: TeamAgentWorktreeMetadata;

  private currentRun?: Promise<string>;
  private closing = false;
  private closed = false;
  private stopPromise?: Promise<void>;

  private constructor(
    readonly identity: TeamIdentity,
    private readonly agent: Agent,
    messageManager: MessageManager,
    private readonly controller: AbortController,
    private readonly workspace: WorktreeResult,
    private readonly teamManager: TeamManager,
    private readonly inspect: typeof inspectWorktree,
    private readonly remove: typeof removeAgentWorktree,
  ) {
    this.messageManager = messageManager;
    this.signal = controller.signal;
    this.worktree = {
      workDir: workspace.path,
      path: workspace.path,
      branch: workspace.branch,
      baseCommit: workspace.headCommit,
    };
  }

  static create(
    identity: TeamIdentity,
    options: TeamAgentSessionFactoryOptions,
  ): PersistentTeamAgentSession {
    // 如果最大循环次数没有的话，就加入默认值
    const maxTurns = options.subAgent.maxTurns ?? DEFAULT_SUBAGENT_MAX_TURNS;
    // 判断maxTurns是否是整数或者maxTurns<=0
    if (!Number.isInteger(maxTurns) || maxTurns <= 0) {
      // 是的话，就返回错误
      throw new Error(`Invalid sub-agent maxTurns: ${maxTurns}`);
    }

    // 如果worktreeFactory存在，则调用worktreeFactory，不然就调用createAgentWorktree
    const workspace = (options.worktreeFactory ?? createAgentWorktree)(
      `${identity.teamName}-${identity.memberName}`,
      options.workDir,
    );
    try {
      // 创建一个取消控制器
      const controller = new AbortController();
      // 拿到调用的模型
      const model = resolveModelId(
        options.modelOverride || options.subAgent.model,
        options.provider,
      );
      // 构建系统提示词
      const basePrompt = buildSubAgentSystemPrompt(
        options.subAgent,
        workspace.path,
        model,
      );
      // 系统提示词+worktree的路径提示词
      const systemPrompt =
        `${basePrompt}\n\n${buildWorktreeNotice(options.workDir, workspace.path)}`;
      //如果clientFactory存在则调用clientFactory，不存在则调用createClient
      const client = (options.clientFactory ?? createClient)({
        provider: options.provider,
        model,
        systemPrompt,
      });
      // 创建过滤部分部分工具后的工具管理器
      const tools = filterToolsForAgent(
        options.parentToolManager,
        options.subAgent.tools,
        options.subAgent.disallowedTools,
        true,
      );
      // 硬编码移除这些tool
      for (const forbidden of [
        "Agent",
        "TeamCreate",
        "TeamDelete",
        "SpawnTeammate",
        "ListTeams",
        "TaskOutput",
        "TaskStop",
        "AskUserQuestion",
      ]) {
        tools.unregister(forbidden);
      }
      // Communication is a runtime capability, not a role-selectable tool.
      //工具管理器里吗注册消息发送工具
      tools.register(new SendMessageTool(options.teamManager, identity));
      // 创建一个消息管理器
      const messageManager = new MessageManager();
      // 创建一个session
      let session: PersistentTeamAgentSession;
      // 创建一个新的Agent
      const agent = new Agent({
        client,
        toolManger: tools,
        permissionCheck: new PermissionChecker(
          workspace.path,
          options.subAgent.permissionMode ?? "acceptEdits",
        ),
        messageManager,
        workDir: workspace.path,
        abortSignal: controller.signal,
        maxTurns,
        beforeTurn: () => session.drainInbox(),
      });
      // 创建一个team session并且存储起来
      session = new PersistentTeamAgentSession(
        identity,
        agent,
        messageManager,
        controller,
        workspace,
        options.teamManager,
        options.worktreeInspector ?? inspectWorktree,
        options.worktreeRemover ?? removeAgentWorktree,
      );
      return session;
    } catch (error) {
      // Construction failed after the worktree was created. Only remove it
      // when inspection proves that no work was written into it.
      const state = (options.worktreeInspector ?? inspectWorktree)(
        workspace.path,
        workspace.headCommit,
        workspace.baselineStatus,
      );
      if (!state.hasChanges) {
        (options.worktreeRemover ?? removeAgentWorktree)(
          workspace.path,
          workspace.branch,
          workspace.gitRoot,
        );
      }
      throw error;
    }
  }

  async run(prompt: string, onEvent?: AgentEventCallback): Promise<string> {
    if (this.closed || this.closing || this.signal.aborted) {
      return Promise.reject(new Error("Team agent session is closed"));
    }
    if (this.currentRun) {
      return Promise.reject(new Error("Team agent session is already running"));
    }

    const operation = this.executeRun(prompt, onEvent);
    this.currentRun = operation;
    return operation.finally(() => {
      if (this.currentRun === operation) this.currentRun = undefined;
    });
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.closing = true;
    this.controller.abort(new Error("Team agent session stopped"));
    this.stopPromise = (async () => {
      try {
        await this.currentRun;
      } catch {
        // Abort and model failures are observed by the owning Team loop.
      }
      const state = this.inspect(
        this.workspace.path,
        this.workspace.headCommit,
        this.workspace.baselineStatus,
      );
      this.worktree = {
        workDir: this.workspace.path,
        path: this.workspace.path,
        branch: this.workspace.branch,
        baseCommit: this.workspace.headCommit,
        headCommit: state.headCommit,
        dirty: state.dirty,
        hasChanges: state.hasChanges,
      };
      if (!state.hasChanges) {
        this.remove(
          this.workspace.path,
          this.workspace.branch,
          this.workspace.gitRoot,
        );
        this.worktree.cleaned = true;
      }
      this.closed = true;
    })();
    return this.stopPromise;
  }

  private drainInbox(): string[] {
    // Team owns mailbox polling while idle; this hook only runs inside run().
    const member = this.teamManager
      .get(this.identity.teamName)
      ?.getMember(this.identity.memberName);
    if (!member) return [];
    return member.mailbox.receiveSync().map(
      (message) => `Team message from ${message.from}:\n${message.text}`,
    );
  }

  private async executeRun(
    prompt: string,
    onEvent?: AgentEventCallback,
  ): Promise<string> {
    this.messageManager.addUserMessage(prompt);
    let output = "";
    let turn = 0;
    for await (const event of this.agent.startLoop()) {
      switch (event.type) {
        case "stream_text":
          output += event.text;
          onEvent?.({ type: "stream_text", text: event.text });
          break;
        case "tool_use":
          onEvent?.({
            type: "tool_use",
            toolName: event.toolName,
            args: event.args,
          });
          break;
        case "usage":
          onEvent?.({
            type: "usage",
            usage: {
              inputTokens: event.usage.inputTokens,
              outputTokens: event.usage.outputTokens,
            },
          });
          break;
        case "turn_complete":
          turn++;
          break;
        case "loop_complete":
          return output || "[No output]";
        case "error":
          throw new SubAgentRunError(
            output
              ? `${event.error.message}\n\nPartial output:\n${output}`
              : event.error.message,
            output,
          );
      }
    }
    void turn;
    return output || "[No output]";
  }
}
