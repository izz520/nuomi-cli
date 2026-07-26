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
  prompt: string;
  parentToolManager: ToolsManger;
  parentProvider: ProviderConfig;
  workDir: string;
  onProgress?: (p: { turn?: number; lastTool?: string }) => void,
  onEvent?: AgentEventSink;
  modelOverride?: string;
  abortSignal?: AbortSignal;
  clientFactory?: typeof createClient;
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

export async function spawnSubAgent({
  subAgent,
  prompt,
  parentToolManager,
  parentProvider,
  workDir,
  onProgress,
  onEvent,
  modelOverride,
  abortSignal,
  clientFactory = createClient,
}: SpawnSubAgentOptions): Promise<string> {
  if (abortSignal?.aborted) {
    throw abortSignal.reason instanceof Error
      ? abortSignal.reason
      : new Error("Sub-agent run aborted");
  }

  // 确定模型：调用级 override > 定义级 model > 父 Agent 的模型
  const effectiveModel = modelOverride || subAgent.model;
  // 能力档位由当前 Provider 解析；未配置档位时回退到 Provider 默认模型。
  const resolvedModel = resolveModelId(effectiveModel, parentProvider);
  const maxTurns = subAgent.maxTurns ?? DEFAULT_SUBAGENT_MAX_TURNS;
  if (!Number.isInteger(maxTurns) || maxTurns <= 0) {
    throw new Error(`Invalid sub-agent maxTurns: ${maxTurns}`);
  }
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
    false, // isAsync — spawnSubAgent 目前是同步路径
  );
  //如果子agent有独立的权限，则按独立的来，不然就是允许编辑的权限
  const permMode = subAgent.permissionMode ?? "acceptEdits";
  // 新建一个checker
  const checker = new PermissionChecker(workDir, permMode);
  // 新建一个消息管理器
  const messageManager = new MessageManager();
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
