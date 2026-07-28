import type { Tool, ToolResult, ToolContext } from "../types/tools.js";
import { strArg, boolArg } from "./utils.js";
import type { SubAgent } from "../types/subAgent.js";
import { loadSubAgents } from "../subAgent/loader.js";
import type { MessageManager } from "../messageManager/message.js";
import type {
  TeamAgentSession,
  TeamIdentity,
  TeamManager,
} from "../teams/team.js";
import type { IMessage } from "../types/messsage.js";

// Fork 子 Agent 的前导标记——用于嵌套 fork 检测
const FORK_BOILERPLATE_TAG = "<fork_boilerplate>";

// Fork 子 Agent 注入的系统指令
const FORK_BOILERPLATE = `${FORK_BOILERPLATE_TAG}
You are a forked worker process. You are NOT the main agent.
Rules (non-negotiable):
1. Do NOT fork again.
2. Do NOT converse, ask questions, or request confirmation.
3. Use tools directly: read files, search code, make changes.
4. Stay strictly within your assigned task scope.
5. Final report must be under 500 characters, starting with "Scope:".
</fork_boilerplate>`;

export class AgentTool implements Tool {
  name = "Agent";
  description = "Launch a sub-agent to handle complex, multi-step tasks.";
  category = "read" as const;
  system = true;

  private subAgents: SubAgent[];
  private messageManager?: MessageManager;

  /** 可选：团队管理器，启用 team_name 参数。 */
  private teamManager?: TeamManager;
  /** 可选：按选定角色创建长期队友 session。 */
  private createTeamAgentSession?: (
    subAgent: SubAgent,
    identity: TeamIdentity,
    modelOverride?: string,
  ) => TeamAgentSession | Promise<TeamAgentSession>;

  private startAgentHandler: (request: SubAgentRunRequest) => Promise<string>;

  constructor(
    // 当前工作目录
    workDir: string,
    // 创建子Agent的回调函数
    startAgentHandler: (request: SubAgentRunRequest) => Promise<string>,
    // 消息管理器
    messageManager?: MessageManager,
  ) {
    // 拿到所有的子Agent定义
    this.subAgents = loadSubAgents(workDir);
    // 把创建后的回调函数存起来
    this.startAgentHandler = startAgentHandler;
    // 把当前消息管理器存起来
    this.messageManager = messageManager;
  }

  //设置team管理器
  setTeamManager(
    mgr: TeamManager,
    createSession: (
      subAgent: SubAgent,
      identity: TeamIdentity,
      modelOverride?: string,
    ) => TeamAgentSession | Promise<TeamAgentSession>,
  ): void {
    //把传递进来的team管理器存起来
    this.teamManager = mgr;
    // 把createSession函数存起来
    this.createTeamAgentSession = createSession;
  }
  // 工具的信息
  schema(): Record<string, unknown> {
    //拿到所有Agent的名字
    const agentTypes = this.subAgents.map((d) => d.name);
    return {
      name: this.name,
      description: this.buildDescription(),
      input_schema: {
        type: "object",
        properties: {
          description: { type: "string", description: "Short description of what the agent will do" },
          prompt: { type: "string", description: "The task for the agent to perform" },
          context_mode: {
            type: "string",
            enum: ["fresh", "fork"],
            default: "fresh",
            description:
              "Context strategy. Defaults to 'fresh'. " +
              "'fresh' starts the selected subagent_type with no conversation history; " +
              "'fork' starts the same selected role with the current conversation history. " +
              "Fork must be selected explicitly.",
          },
          subagent_type: {
            type: "string",
            enum: agentTypes,
            description:
              "Predefined agent role used with either context mode. " +
              "The value must be one of the configured agent definitions.",
          },
          model: {
            type: "string",
            description:
              "Override the model using a capability tier (fast, standard, strong) " +
              "or a full model ID supported by the active provider.",
          },
          run_in_background: {
            type: "boolean",
            description:
              "Run asynchronously and return a task_id immediately. Prefer true when the parent " +
              "can continue independent work; use false when the next step requires this result " +
              "or concurrent edits could conflict.",
            default: false,
          },
          team_name: {
            type: "string",
            description:
              "REQUIRED when creating team members. Spawns the agent as a long-running " +
              "teammate under this team (created via TeamCreate). Unlike regular sub-agents, " +
              "team members persist after the lead returns and communicate via SendMessage. " +
              "Without team_name the agent runs as a one-shot sub-agent that blocks and returns inline.",
          },
        },
        required: ["description", "prompt"],
      },
    };
  }

  private buildDescription(): string {
    let desc = `Launch a sub-agent to handle a complex task.

Choose the context strategy explicitly with "context_mode":
- "fresh": start the selected "subagent_type" with no conversation history.
- "fork": start the selected "subagent_type" with the current conversation history.

When "context_mode" is omitted it defaults to "fresh".
"subagent_type" selects the configured role and is required for both context modes.

This is ONE tool with multiple roles. Roles are NOT separate tools — you pick one by passing its name in the "subagent_type" parameter. Do not search for a tool named after a role; call THIS tool ("Agent") and set "subagent_type".

Available roles for "subagent_type":`;

    for (const def of this.subAgents) {
      desc += `\n- ${def.name}: ${def.description}`;
    }

    desc += `

Example call shape:
{
  "name": "Agent",
  "input": {
    "context_mode": "fresh",
    "subagent_type": "<role from the list above>",
    "description": "Short task label",
    "prompt": "Detailed instructions — the sub-agent has zero prior context"
  }
}

For context_mode="fresh", write a detailed prompt because the sub-agent has no prior conversation context.
For context_mode="fork", the prompt may refer to the inherited conversation, but should still state the concrete task.
Prefer run_in_background=true whenever you can continue useful work without this result. Agent then returns a task_id immediately; use TaskOutput when the result becomes necessary or TaskStop to cancel it.
Use foreground execution only when your next step immediately depends on the result, the task is very short, or concurrent edits could conflict.
When tasks are independent, launch multiple background sub-agents in parallel by making multiple Agent tool calls in a single response.`;
    return desc;
  }

  async execute(args: Record<string, unknown>, ctx?: ToolContext): Promise<ToolResult> {
    //拿到子Agent的秒速
    const description = strArg(args, "description");
    // 拿到子Agent的prompt
    const prompt = strArg(args, "prompt");
    // 如果描述或者prompt不存在，则直接返回错误结果给Agent
    if (!description || !prompt) {
      return { output: "Error: description and prompt are required", isError: true };
    }
    // 拿到Agent的类型，即哪个子Agent
    const subagentType = strArg(args, "subagent_type");
    // 上下文模式默认 fresh；fork 必须显式指定。
    const contextMode = strArg(args, "context_mode") || "fresh";
    if (contextMode !== "fresh" && contextMode !== "fork") {
      return {
        output: `Error: unknown context_mode '${contextMode}'. Available: fresh, fork`,
        isError: true,
      };
    }
    // 拿到这个子Agent调用的模型
    const modelOverride = strArg(args, "model");
    // 拿到这个子Agent是同步任务还是异步任务
    const background = boolArg(args, "run_in_background");
    // 拿到Team的Name
    const teamName = strArg(args, "team_name");

    // fresh 和 fork 都必须选择一个已配置的 Agent 角色。
    if (!subagentType) {
      return {
        output: `Error: subagent_type is required when context_mode is '${contextMode}'`,
        isError: true,
      };
    }

    const subAgent = this.subAgents.find((d) => d.name === subagentType);
    if (!subAgent) {
      return {
        output: `Error: unknown agent type '${subagentType}'. Available: ${this.subAgents.map((d) => d.name).join(", ")}`,
        isError: true,
      };
    }

    // Team-member 路径：仍须显式选择并验证 subagent_type。团队模式
    // 使用长期 session，不允许缺少 runtime 接线时静默退化为 one-shot。
    if (teamName) {
      if (!this.teamManager || !this.createTeamAgentSession) {
        return {
          output: "Error: team agent runtime is not configured.",
          isError: true,
        };
      }

      return this.runAsTeammate(
        teamName,
        description,
        prompt,
        subAgent,
        modelOverride || undefined,
      );
    }

    let runRequest: SubAgentRunRequest;
    if (contextMode === "fork") {
      if (!this.messageManager) {
        return { output: "Error: fork requires parent conversation context", isError: true };
      }
      // 子 Agent 的工具过滤已移除 Agent 工具；扫描标记作为第二层防护，
      // 避免未来工具策略变化后出现嵌套 fork。
      for (const msg of this.messageManager.getMessages()) {
        if (msg.content.includes(FORK_BOILERPLATE_TAG)) {
          return {
            output: "Error: cannot fork from a forked agent. Use context_mode='fresh' with subagent_type instead.",
            isError: true,
          };
        }
      }
      const parentMessages = this.snapshotForkMessages();
      runRequest = {
        contextMode: "fork",
        subAgent,
        parentMessages,
        description,
        prompt: `${FORK_BOILERPLATE}\n\nYour task:\n${prompt}`,
        background: background || !!subAgent.background,
        modelOverride: modelOverride || undefined,
        abortSignal: ctx?.abortSignal,
        onActivity: ctx?.onActivity,
      };
    } else {
      runRequest = {
        contextMode: "fresh",
        subAgent,
        description,
        prompt,
        background: background || !!subAgent.background,
        modelOverride: modelOverride || undefined,
        abortSignal: ctx?.abortSignal,
        onActivity: ctx?.onActivity,
      };
    }

    try {
      const output = await this.startAgentHandler(runRequest);
      return { output, isError: false };
    } catch (err) {
      return {
        output: `${contextMode === "fork" ? "Fork" : "Agent"} error: ${(err as Error).message}`,
        isError: true,
      };
    }
  }

  /**
   * AgentTool 执行时，父历史的最后一条通常正是尚未返回结果的 Agent tool_use。
   * Fork 只能复制已经闭合的历史，否则 Provider 会收到缺少 tool_result 的调用链。
   */
  private snapshotForkMessages(): IMessage[] {
    const messages = this.messageManager?.getMessages() ?? [];
    const last = messages.at(-1);
    if (!last?.toolUses?.length) return messages;

    const stableMessages = messages.slice(0, -1);
    if (last.content.trim()) {
      stableMessages.push({
        role: "assistant",
        content: last.content,
      });
    }
    return stableMessages;
  }

  /**
   * Team-member 模式：在指定团队中生成一个长驻队友。
   * 对齐 Go/Java 的 Agent 工具 team_name 代码路径，
   * 委托给 Team.spawnTeammate() 启动 idle-poll 主循环。
   */
  private runAsTeammate(
    teamName: string,
    description: string,
    prompt: string,
    subAgent: SubAgent,
    modelOverride?: string,
  ): ToolResult {
    //从team管理器中查找这个team
    const team = this.teamManager!.get(teamName);
    if (!team) {
      // team不存在，则返回错误
      return {
        output: `Error: team '${teamName}' not found. Create it first with TeamCreate.`,
        isError: true,
      };
    }

    // 从 description 派生 path-safe 队友名称。中文或纯符号描述会
    // 退回到角色名，避免把非法名称传给 mailbox/worktree。
    const normalizeMemberName = (value: string): string => value
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^[-_]+|[-_]+$/g, "");
    //拿到描述名称
    const descriptionName = normalizeMemberName(description);
    // 从Agent的名字中拿到角色名称
    const roleName = normalizeMemberName(subAgent.name) || "teammate";
    //然后取前64个字符作为member成员名称
    const base = (descriptionName || `${roleName}-member`).slice(0, 64);
    let memberName = base;
    let suffix = 2;
    //防止名字重复，给名字加一个后缀
    while (team.getMember(memberName)) {
      const marker = `-${suffix++}`;
      memberName = `${base.slice(0, 64 - marker.length)}${marker}`;
    }
    // 调用team的spawnTeammate添加成员
    team.spawnTeammate(
      memberName,
      prompt,
      (identity) => this.createTeamAgentSession!(
        subAgent,
        identity,
        modelOverride,
      ),
    );
    return {
      output: `Teammate '${memberName}' spawned in team '${teamName}' (mode: ${team.mode}). ` +
        `The teammate is now working on the assigned task.`,
      isError: false,
    };
  }

}

interface SubAgentRunCommon {
  description: string;
  prompt: string;
  background: boolean;
  modelOverride?: string;
  abortSignal?: AbortSignal;
  onActivity?: () => void;
}

export type SubAgentRunRequest =
  | SubAgentRunCommon & {
    contextMode: "fresh";
    subAgent: SubAgent;
  }
  | SubAgentRunCommon & {
    contextMode: "fork";
    subAgent: SubAgent;
    parentMessages: IMessage[];
  };
