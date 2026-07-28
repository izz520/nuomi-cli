import createClient from "../client/create.js";
import { resolveModelId } from "../client/model-resolver.js";
import { MessageManager } from "../messageManager/message.js";
import { buildSystemPrompt, detectEnvironment } from "../prompt/builder.js";
import { ToolsManger } from "../tools/register.js";
import { PermissionChecker } from "../premisson/checker.js";
import { Agent } from "../client/agent.js";
import type { SubAgent } from "../types/subAgent.js";
import type { ProviderConfig } from "../types/provider.js";
import { filterToolsForAgent } from "../tools/tool-filter.js";
import AnthropicClient from "../client/anthorpic.js";
import OpenAIClient from "../client/openai.js";
import { buildMessageManager } from "../messageManager/buildMessage.js";
import type { IMessage } from "../types/messsage.js";
import {
  buildWorktreeNotice,
  createAgentWorktree,
  inspectWorktree,
  removeAgentWorktree,
  type WorktreeResult,
} from "../worktree/worktree.js";

export const DEFAULT_SUBAGENT_MAX_TURNS = 20;

export type AgentEventSink = (event: {
  type: string;
  toolName?: string;
  args?: Record<string, unknown>;
  usage?: { inputTokens: number; outputTokens: number };
  text?: string;
}) => void;

export interface SpawnSubAgentOptions {
  subAgent: SubAgent;
  contextMode?: "fresh" | "fork";
  parentMessages?: IMessage[];
  prompt: string;
  parentToolManager: ToolsManger;
  parentProvider: ProviderConfig;
  workDir: string;
  onProgress?: (p: { turn?: number; lastTool?: string }) => void,
  onActivity?: () => void;
  onEvent?: AgentEventSink;
  modelOverride?: string;
  abortSignal?: AbortSignal;
  background?: boolean;
  clientFactory?: typeof createClient;
  worktreeSlug?: string;
}

export class SubAgentRunError extends Error {
  constructor(message: string, readonly partialOutput = "") {
    super(message);
    this.name = "SubAgentRunError";
  }
}

export function buildSubAgentSystemPrompt(
  subAgent: SubAgent,
  workDir: string,
  model: string,
): string {
  const override = subAgent.systemPromptOverride?.trim();
  if (override) return override;

  const env = detectEnvironment(workDir);
  env.model = model;
  const basePrompt = buildSystemPrompt(env);
  const rolePrompt = subAgent.initialPrompt?.trim();
  return rolePrompt
    ? `${basePrompt}\n\n# Sub-agent role\n${rolePrompt}`
    : basePrompt;
}

export async function startSubAgent(
  options: SpawnSubAgentOptions,
): Promise<string> {
  // 如果不是worktree，则直接调用runSubAgent
  if (options.subAgent.isolation !== "worktree") {
    return runSubAgent(options);
  }
  // worktree的唯一表示标识
  const slug = options.worktreeSlug
    ?? `${options.subAgent.name}-${Date.now().toString(36)}`;
  //创建worktree
  const workspace = createAgentWorktree(slug, options.workDir);
  //构建Agent信息
  const isolatedOptions: SpawnSubAgentOptions = {
    ...options,
    subAgent: { ...options.subAgent, isolation: undefined },
    workDir: workspace.path,
    prompt: `${buildWorktreeNotice(options.workDir, workspace.path)}\n\n${options.prompt}`,
  };

  try {
    const output = await runSubAgent(isolatedOptions);
    return finalizeWorktreeRun(output, workspace);
  } catch (error) {
    const suffix = finalizeWorktreeRun("", workspace);
    if (suffix) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SubAgentRunError(`${message}\n\n${suffix}`);
    }
    throw error;
  }
}

function finalizeWorktreeRun(output: string, workspace: WorktreeResult): string {
  const state = inspectWorktree(
    workspace.path,
    workspace.headCommit,
    workspace.baselineStatus,
  );
  if (!state.hasChanges) {
    removeAgentWorktree(workspace.path, workspace.branch, workspace.gitRoot);
    return output;
  }

  const metadata = {
    path: workspace.path,
    branch: workspace.branch,
    baseCommit: workspace.headCommit,
    headCommit: state.headCommit,
    dirty: state.dirty,
  };
  const notice =
    "Worktree changes were preserved for parent-agent review and integration:\n" +
    JSON.stringify(metadata, null, 2);
  return output ? `${output}\n\n${notice}` : notice;
}

async function runSubAgent({
  //子Agent的定义
  subAgent,
  // 上下文模式
  contextMode = "fresh",
  // 父级消息管理器
  parentMessages,
  // 系统提示词
  prompt,
  // 父级工具管理器
  parentToolManager,
  // 父级Provider
  parentProvider,
  // 当前工作目录
  workDir,
  // 更新进度的函数
  onProgress,
  onActivity,
  // 更新strable事件流
  onEvent,
  // model重写
  modelOverride,
  // 取消
  abortSignal,
  // 是否是后台执行
  background = false,
  // 创建client的函数
  clientFactory = createClient,
}: SpawnSubAgentOptions): Promise<string> {
  // 如果取消了，则返回取消原因或者直接报错
  if (abortSignal?.aborted) {
    throw abortSignal.reason instanceof Error
      ? abortSignal.reason
      : new Error("Sub-agent run aborted");
  }
  // 确定模型：调用级 override > 定义级 model > 父 Agent 的模型
  const effectiveModel = modelOverride || subAgent.model;
  // 能力档位由当前 Provider 解析；未配置档位时回退到 Provider 默认模型。
  const resolvedModel = resolveModelId(effectiveModel, parentProvider);
  // 最大循环调用次数
  const maxTurns = subAgent.maxTurns ?? DEFAULT_SUBAGENT_MAX_TURNS;
  // 如果不是整数，或者小于0，则报错
  if (!Number.isInteger(maxTurns) || maxTurns <= 0) {
    throw new Error(`Invalid sub-agent maxTurns: ${maxTurns}`);
  }
  // 构建新的系统提示词
  const systemPrompt = buildSubAgentSystemPrompt(subAgent, workDir, resolvedModel);
  // 每个子 Agent 都使用独立 Client，避免父子系统提示词和并行请求互相污染。
  const client: AnthropicClient | OpenAIClient = clientFactory({
    provider: parentProvider,
    model: resolvedModel,
    systemPrompt,
  });
  // 通过多层过滤构建子 Agent 工具注册表（对齐 Go 的 FilterToolsForAgent）
  const filterToolManager = filterToolsForAgent(
    parentToolManager,
    subAgent.tools,
    subAgent.disallowedTools,
    background,
  );
  //如果子agent有独立的权限，则按独立的来，不然就是允许编辑的权限
  const permMode = subAgent.permissionMode ?? "acceptEdits";
  // 新建一个checker
  const checker = new PermissionChecker(workDir, permMode);

  if (contextMode === "fork" && !parentMessages) {
    throw new Error("Fork sub-agent requires parent messages");
  }
  // fresh 使用全新上下文；fork 复制父 Agent 的消息历史。
  const messageManager = contextMode === "fork"
    ? buildMessageManager(parentMessages!)
    : new MessageManager();
  // 把prompt添加为用户消息
  messageManager.addUserMessage(prompt);
  // 创建一个agnet
  const agent = new Agent({
    client,
    toolManger: filterToolManager,
    permissionCheck: checker,
    messageManager: messageManager,
    workDir,
    abortSignal,
    maxTurns,
  });

  let output = "";
  let turn = 0;
  // 循环消费Agent
  for await (const event of agent.startLoop()) {
    onActivity?.();
    switch (event.type) {
      case "stream_text":
        output += event.text;
        break;
      case "tool_use":
        onProgress?.({ lastTool: event.toolName });
        onEvent?.({ type: "tool_use", toolName: event.toolName, args: event.args });
        break;
      case "usage":
        onEvent?.({ type: "usage", usage: { inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens } });
        break;
      case "turn_complete":
        onProgress?.({ turn: ++turn });
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
  //最后返回Agent的的结果
  return output || "[No output]";
}
