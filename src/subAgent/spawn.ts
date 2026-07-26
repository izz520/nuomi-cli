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

export type AgentEventSink = (event: {
  type: string;
  toolName?: string;
  args?: Record<string, unknown>;
  usage?: { inputTokens: number; outputTokens: number };
  text?: string;
}) => void;

export async function spawnSubAgent(
  // 当前subagent
  subAgent: SubAgent,
  // 系统提示词
  prompt: string,
  // 父级client
  parentClient: AnthropicClient | OpenAIClient,
  //父级的工具管理器
  parentToolManager: ToolsManger,
  // 父级的provider
  parentProvider: ProviderConfig,
  // 当前的工作目录
  workDir: string,
  // 点击
  onProgress?: (p: { turn?: number; lastTool?: string }) => void,
  // 事件
  onEvent?: AgentEventSink,
  // 复写model
  modelOverride?: string,
): Promise<string> {
  // 确定模型：调用级 override > 定义级 model > 父 Agent 的模型
  const effectiveModel = modelOverride || subAgent.model;
  // 拿到最终调用的model
  const resolvedModel = effectiveModel ? resolveModelId(effectiveModel) : parentProvider.model;
  // 获取系统信息
  const env = detectEnvironment(workDir);
  // 把model赋值为最终确定的model
  env.model = resolvedModel;
  // 如果子agent有提示词就用子agent的，没有的话，就根据当前系统信息，重新构建一个系统提示词
  const systemPrompt = subAgent.systemPromptOverride ?? buildSystemPrompt(env);
  // 子agent或者modelOverride有指定model的话，就重新创建一个，不然就沿用父级的client
  const client: AnthropicClient | OpenAIClient = effectiveModel
    ? createClient({ provider: parentProvider, systemPrompt: systemPrompt, model: resolvedModel })
    : parentClient;

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
    workDir
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
        return output
          ? `${output}\n\n[Error: ${event.error.message}]`
          : `Error: ${event.error.message}`;
    }
  }
  //最后返回Agent的的结果
  return output || "[No output]";
}
