import type { Tool, ToolResult, ToolContext } from "../types/tools.js";
import { strArg, boolArg } from "./utils.js";
import type { SubAgent } from "../types/subAgent.js";
import { loadSubAgents } from "../subAgent/loader.js";
import type { ToolsManger } from "../tools/register.js";
import type { MessageManager } from "../messageManager/message.js";
import type { TeamManager, RunAgent } from "../teams/team.js";

// Fork 子 Agent 的前导标记——用于嵌套 fork 检测
const FORK_BOILERPLATE_TAG = "<fork_boilerplate>";
const FORK_QUERY_SOURCE = "agent:builtin:fork";

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
  private toolManager: ToolsManger;
  private messageManager?: MessageManager;

  // 标识当前 AgentTool 实例所处的派生上下文；
  // 非空且等于 FORK_QUERY_SOURCE 时禁止再次 fork
  querySource = "";

  /** 可选：团队管理器，启用 team_name 参数。 */
  private teamManager?: TeamManager;
  /** 可选：用于生成队友的 RunAgent 回调。 */
  private teamRunAgent?: RunAgent;

  private spawnHandler: (
    subAgent: SubAgent,
    prompt: string,
    background: boolean,
    modelOverride?: string,
  ) => Promise<string>;

  private forkHandler?: (
    prompt: string,
    messageManager: MessageManager,
    toolManager: ToolsManger,
    modelOverride?: string,
  ) => Promise<string>;

  constructor(
    // 当前工作目录
    workDir: string,
    // 工具管理器
    toolManager: ToolsManger,
    // 创建子Agent的回调函数
    spawnHandler: (subAgent: SubAgent, prompt: string, bg: boolean, modelOverride?: string) => Promise<string>,
    // 消息管理器
    messageManager?: MessageManager,
    // fork的回调函数
    forkHandler?: (prompt: string, messageManager: MessageManager, toolManager: ToolsManger, modelOverride?: string) => Promise<string>,
  ) {
    // 拿到所有的子Agent定义
    this.subAgents = loadSubAgents(workDir);
    // 把当前工具管理器存起来
    this.toolManager = toolManager;
    // 把创建后的回调函数存起来
    this.spawnHandler = spawnHandler;
    // 把当前消息管理器存起来
    this.messageManager = messageManager;
    // 把fork模式的回调函数存起来
    this.forkHandler = forkHandler;
  }

  /**
   * 设置团队管理器和队友运行回调，启用 team_name 参数。
   * 设置后 Agent 工具可以直接生成队友，无需单独的 SpawnTeammate 工具。
   */
  setTeamManager(mgr: TeamManager, runAgent: RunAgent): void {
    this.teamManager = mgr;
    this.teamRunAgent = runAgent;
  }
  // 工具的信息
  schema(): Record<string, unknown> {
    const agentTypes = this.subAgents.map((d) => d.name);
    return {
      name: this.name,
      description: this.buildDescription(),
      input_schema: {
        type: "object",
        properties: {
          description: { type: "string", description: "Short description of what the agent will do" },
          prompt: { type: "string", description: "The task for the agent to perform" },
          subagent_type: {
            type: "string",
            enum: agentTypes,
            description: "Agent type. Omit to fork current conversation context.",
          },
          model: {
            type: "string",
            enum: ["sonnet", "opus", "haiku"],
            description: "Override the model for this agent.",
          },
          run_in_background: { type: "boolean", description: "Run in background", default: false },
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
    let desc = `Launch a sub-agent to handle a complex task. Each sub-agent runs independently with its own context. The sub-agent cannot see the current conversation.

This is ONE tool with multiple roles. Roles are NOT separate tools — you pick one by passing its name in the "subagent_type" parameter. Do not search for a tool named after a role; call THIS tool ("Agent") and set "subagent_type".

Available roles for the "subagent_type" parameter:`;

    for (const def of this.subAgents) {
      desc += `\n- ${def.name}: ${def.description}`;
    }

    desc += `

Example call shape:
{
  "name": "Agent",
  "input": {
    "subagent_type": "<role from the list above>",
    "description": "Short task label",
    "prompt": "Detailed instructions — the sub-agent has zero prior context"
  }
}

Write a detailed prompt explaining what the sub-agent should do and why — it has no prior context.
When tasks are independent, launch multiple sub-agents in parallel by making multiple Agent tool calls in a single response.`;
    return desc;
  }

  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const description = strArg(args, "description");
    const prompt = strArg(args, "prompt");
    if (!description || !prompt) {
      return { output: "Error: description and prompt are required", isError: true };
    }

    const subagentType = strArg(args, "subagent_type");
    const modelOverride = strArg(args, "model");
    const background = boolArg(args, "run_in_background");
    const teamName = strArg(args, "team_name");

    // Team-member 路径：team_name 优先于 fork/subagent，将 agent 作为
    // 长驻队友运行，完成后通过 SendMessage / mailbox 通知 lead。
    if (teamName && this.teamManager && this.teamRunAgent) {
      return this.runAsTeammate(teamName, description, prompt);
    }

    // Fork 路径：没有指定 subagent_type 时继承父对话上下文
    if (!subagentType) {
      return this.runFork(prompt, description, modelOverride);
    }

    // 定义路径：按 subagent_type 查找 Agent 定义
    const subAgent = this.subAgents.find((d) => d.name === subagentType);
    if (!subAgent) {
      return {
        output: `Error: unknown agent type '${subagentType}'. Available: ${this.subAgents.map((d) => d.name).join(", ")}`,
        isError: true,
      };
    }

    try {
      //拿到结果
      const output = await this.spawnHandler(subAgent, prompt, background || !!subAgent.background, modelOverride);
      // 返回给调用的Agent
      return { output, isError: false };
    } catch (err) {
      return {
        output: `Agent error: ${(err as Error).message}`,
        isError: true,
      };
    }
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
  ): ToolResult {
    const team = this.teamManager!.get(teamName);
    if (!team) {
      return {
        output: `Error: team '${teamName}' not found. Create it first with TeamCreate.`,
        isError: true,
      };
    }

    // 从 description 派生队友名称，去重
    let memberName = description
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 30);
    let suffix = 2;
    const base = memberName;
    while (team.getMember(memberName)) {
      memberName = `${base}-${suffix++}`;
    }

    team.spawnTeammate(memberName, prompt, this.teamRunAgent!);
    return {
      output: `Teammate '${memberName}' spawned in team '${teamName}' (mode: ${team.mode}). ` +
        `The teammate is now working on the assigned task.`,
      isError: false,
    };
  }

  /**
   * Fork 模式：继承父对话上下文，在后台运行。
   * 与定义模式不同，fork 子 Agent 能看到父对话的全部历史，
   * 实现 prompt-cache prefix 的字节对齐以提高缓存命中率。
   */
  private async runFork(
    prompt: string,
    description: string,
    modelOverride: string,
  ): Promise<ToolResult> {
    if (!this.messageManager || !this.forkHandler) {
      return { output: "Error: fork requires parent conversation context", isError: true };
    }

    // 嵌套 fork 检测——两层防护：
    // (1) 主检测：querySource 标记（即使对话被压缩也能检测）
    // (2) 回退：扫描对话历史中的 fork 标记
    if (this.querySource === FORK_QUERY_SOURCE) {
      return {
        output: "Error: cannot fork from a forked agent. Use subagent_type to spawn a definition-based agent instead.",
        isError: true,
      };
    }
    for (const msg of this.messageManager.getMessages()) {
      if (msg.content.includes(FORK_BOILERPLATE_TAG)) {
        return {
          output: "Error: cannot fork from a forked agent. Use subagent_type to spawn a definition-based agent instead.",
          isError: true,
        };
      }
    }

    try {
      const output = await this.forkHandler(
        `${FORK_BOILERPLATE}\n\nYour task:\n${prompt}`,
        this.messageManager,
        this.toolManager,
        modelOverride,
      );
      return {
        output: `Forked agent "${description}" launched in background. Results will arrive via task-notification.`,
        isError: false,
      };
    } catch (err) {
      return {
        output: `Fork error: ${(err as Error).message}`,
        isError: true,
      };
    }
  }
}
