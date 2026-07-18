import { AutoCompactRetryCount, compactContextMessage, estimateStaticRequestTokens } from "../compact/message-compact.js";
import { RecoveryManager } from "../compact/recovery.js";
import { ToolResultCompactStateManger } from "../compact/state.js";
import { compactToolResults } from "../compact/tool-compact.js";
import { createUsageAnchor } from "../compact/usage-anchor.js";
import { buildMessageManager } from "../messageManager/buildMessage.js";
import { MessageManager } from "../messageManager/message.js";
import { Decision, PermissionChecker } from "../premisson/checker.js";
import { ToolsManger } from "../tools/register.js";
import { AgentEvent } from "../types/agent.js";
import { UsageAnchor } from "../types/compact.js";
import { ToolResultBlock, ToolUseBlock } from "../types/messsage.js";
import { ProviderConfig } from "../types/provider.js";
import { RuntimeContextManager } from "../context/runtime-context.js";
import writeLog from "../utils/writeLog.js";
import AnthropicClient from "./anthorpic.js";
import createClient from "./create.js";
import OpenAIClient from "./openai.js";
import { ToolExecutManger } from "./tool-execut-manger.js";

interface IAgentConfig {
    client: AnthropicClient | OpenAIClient,
    messageManager: MessageManager,
    toolManger: ToolsManger,
    workDir: string,
    abortSignal: AbortSignal,
    permissionCheck: PermissionChecker
    toolResultCompactManger: ToolResultCompactStateManger
    contextWindow: number | undefined
    recoveryManager: RecoveryManager
    runtimeContextManager: RuntimeContextManager
    onPermissionRequest?: (
        toolName: string,
        args: Record<string, unknown>,
        decision: Decision
    ) => Promise<"allow" | "deny" | "allowAlways">;
}
// value, then attempt a bounded number of multi-turn recoveries. Mirrors Go.
const MAX_TOKENS_CEILING = 64000;
const MAX_OUTPUT_TOKENS_RECOVERIES = 3;
// Hard per-result cap on tool output stored back into the conversation. The
// toolresult budget handles spilling separately; this is a final safety cap.
const MAX_OUTPUT_CHARS = 10000;
export class Agent {
    private messageManager: MessageManager
    private client: AnthropicClient | OpenAIClient
    private toolManger: ToolsManger
    private usageAnchor: UsageAnchor | null = null;
    private abortSignal: AbortSignal
    private workDir: string;
    private permissionCheck: PermissionChecker;
    private toolResultCompactManger: ToolResultCompactStateManger;
    private contextWindow: number
    private maxOutput = 8192
    private autoCompactRetryCount = new AutoCompactRetryCount()
    private recoveryManager: RecoveryManager
    private runtimeContextManager: RuntimeContextManager
    private onPermissionRequest: IAgentConfig['onPermissionRequest']
    constructor({ client, messageManager, workDir, abortSignal, permissionCheck, toolManger, toolResultCompactManger, contextWindow, recoveryManager, runtimeContextManager, onPermissionRequest }: IAgentConfig) {
        this.client = client
        this.messageManager = messageManager
        this.toolManger = toolManger
        this.workDir = workDir
        this.abortSignal = abortSignal
        this.permissionCheck = permissionCheck
        this.toolResultCompactManger = toolResultCompactManger
        this.contextWindow = contextWindow ?? 200000
        this.recoveryManager = recoveryManager
        this.runtimeContextManager = runtimeContextManager
        this.onPermissionRequest = onPermissionRequest

    }
    //开始循环
    async *startLoop(): AsyncGenerator<AgentEvent> {
        // console.log("🚀 ~ Agent ~ startLoop ~ toolSchemas:", toolSchemas)
        let looping = true;
        //开始循环Loop
        while (looping) {
            let toolSchemas = this.toolManger.getAllSchemas();
            //拿到指令+长期记忆的prompt
            const runtimeContext = this.runtimeContextManager.buildMessage();
            //计算系统提示词+指令+长期记忆+工具的token大概是多少
            const staticRequestTokens = estimateStaticRequestTokens(
                this.client.getSystemPrompt(),
                runtimeContext,
                toolSchemas,
            );
            //拿到所有工具的名称
            const toolSchemaNames = this.toolManger.listTools().map((t) => t.name);
            // console.log("进入loop");
            //回答的内容
            let answer = ""
            //思考
            const thinkingBlocks: { thinking: string; signature: string }[] = [];
            let thinkingStarted = false;
            //工具
            let toolUses: ToolUseBlock[] = []
            //结束标识
            let stopReason = "end_turn"
            //记录工具调用次数
            let consecutiveUnknown = 0;
            // ✨ 这里要开始压缩
            // 先压缩工具调用结果
            const compactToolResultMessage = compactToolResults(
                this.messageManager.getMessages(), this.workDir, this.toolResultCompactManger
            );
            // 再压缩上下文消息
            const compactMessageResult = await compactContextMessage(
                this.messageManager,
                this.client,
                this.contextWindow,
                this.maxOutput,
                this.autoCompactRetryCount,
                this.recoveryManager,
                toolSchemaNames,
                this.usageAnchor,
                "",
                compactToolResultMessage,
                staticRequestTokens,
            )
            if (compactMessageResult.message) {
                // 如果消息有内容的话，就流失传输给上层
                yield { type: "compact", message: compactMessageResult.message, boundary: compactMessageResult.boundary };
            }
            if (compactMessageResult.compacted) {
                //压缩成功后，把usageAnchor置空，让下次会话的精准计算再来覆盖
                this.usageAnchor = null;
            }
            /**
             * 这里为什么要构建一个新的原因：
             * 1.this.messageManager的消息列表其实在compactContextMessage就已经改成了压缩后的了
             * 2.但是有几条保留的消息，可能还会存在有工具调用，所以就从新再压缩了一次工具调用
             * 3.担心消息列表会出错，所以重新构造了
             * 其实这里不太理解，为什么要这样？？？
             */
            const compactMessageManager = buildMessageManager(
                compactMessageResult.compacted
                    ? compactToolResults(this.messageManager.getMessages(), this.workDir, this.toolResultCompactManger)
                    : compactToolResultMessage
            );

            //拿到当前的会话token总数
            const sentMessageCount = this.messageManager.len();

            // 发送消息给AI
            const result = this.client.sendMessageStream(compactMessageManager, toolSchemas, {
                abortSignal: this.abortSignal,
                runtimeContext,
            })
            for await (const message of result) {
                switch (message.type) {
                    case "thinking_delta": {
                        //思考中的文本
                        if (!thinkingStarted) {
                            thinkingStarted = true;
                            yield ({
                                type: "thinking_start",
                                text: ""
                            })
                        }
                        yield ({
                            type: "thinking_text",
                            text: message.text
                        })
                        break;
                    }
                    case "text_delta": {
                        //回答的文本
                        answer += message.text
                        yield ({
                            type: "stream_text",
                            text: message.text
                        })
                        break;
                    }
                    case "thinking_complete": {
                        //思考完成
                        thinkingBlocks.push({
                            thinking: message.thinking,
                            signature: message.signature,
                        });
                        yield ({
                            type: "thinking_complete",
                            thinking: message.thinking,
                            signature: message.signature
                        })
                        break;

                    }
                    case "tool_call_complete": {
                        //调用工具
                        toolUses.push({
                            toolUseId: message.toolId,
                            toolName: message.toolName,
                            arguments: message.arguments,
                        });
                        yield ({
                            type: "tool_use",
                            toolName: message.toolName,
                            toolId: message.toolId,
                            args: message.arguments
                        })
                        break;
                    }
                    case "stream_end": {
                        stopReason = message.stopReason;
                        this.usageAnchor = createUsageAnchor(
                            message.usage,
                            sentMessageCount,
                            staticRequestTokens,
                        );
                        yield { type: "usage", usage: message.usage };
                        break;
                    }
                }
            }
            //把本次AI回答的问题加入到会话管理器中
            this.messageManager.addAssistantFull(answer, thinkingBlocks, toolUses);
            //判断是否有工具调用
            if (toolUses.length > 0) {
                // console.log("有工具调用");

                //进行工具分类和并发
                const categoaryTools = this.categoryTools(toolUses)

                // console.log("🚀 ~ Agent ~ startLoop ~ categoaryTools:", categoaryTools)
                //总的结果
                const toolTotalOrignResult: AgentEvent[] = []
                //并发
                for (const cateTool of categoaryTools) {
                    yield {
                        type: "tool_group_start",
                        groupId: `tool-group:${cateTool.tools[0].toolUseId}`,
                        concurrent: cateTool.concurrent,
                        tools: cateTool.tools.map((tool) => ({
                            toolId: tool.toolUseId,
                            toolName: tool.toolName,
                            args: tool.arguments,
                        })),
                    }
                    //拿到当前分类下所有工具结果
                    const cateResults = await this.batchExecute(cateTool.tools, cateTool.concurrent)
                    toolTotalOrignResult.push(...cateResults)
                    // 每组执行完成后立即同步给 UI，避免已完成的工具仍显示运行中。
                    for (const toolResult of cateResults) {
                        yield toolResult
                    }
                }
                // console.log("🚀 ~ Agent ~ startLoop ~ toolTotalOrignResult:", toolTotalOrignResult)

                for (const tu of toolUses) {
                    if (this.toolManger.get(tu.toolName)) consecutiveUnknown = 0;
                    else consecutiveUnknown++;
                }
                //如果consecutiveUnknown大于5次，则直接报错
                if (consecutiveUnknown >= 5) {
                    yield { type: "error", error: new Error("Too many consecutive unknown tool calls") };
                    return;
                }
                const toolResults: ToolResultBlock[] = [];
                //循环把调用结果存储到toolResults里面
                for (const r of toolTotalOrignResult) {
                    if (r.type === "tool_result") {
                        toolResults.push({
                            toolUseId: r.toolId,
                            content:
                                r.output.length > MAX_OUTPUT_CHARS
                                    ? r.output.slice(0, MAX_OUTPUT_CHARS) + "\n… (output truncated)"
                                    : r.output,
                            isError: r.isError,
                        });
                    }
                }
                this.messageManager.addToolResultsMessage(toolResults);
                yield { type: "turn_complete" };
            } else {
                looping = false
                yield { type: "loop_complete", stopReason };
            }
        }


    }
    //工具分类
    private categoryTools(tools: ToolUseBlock[]) {
        const categoryTools: Array<{ concurrent: boolean; tools: ToolUseBlock[] }> = [];
        //循环全部工具
        for (const tool of tools) {
            //获取工具名
            const toolRegister = this.toolManger.get(tool.toolName)
            //判断工具分类
            const category = toolRegister?.category ?? "command"
            //是否是读取，读取可以并发读取
            const concurrent = category === "read"
            if (concurrent && categoryTools.length > 0 && categoryTools[categoryTools.length - 1].concurrent) {
                categoryTools[categoryTools.length - 1].tools.push(tool)
            } else {
                categoryTools.push({
                    concurrent: concurrent,
                    tools: [tool]
                })
            }
        }
        return categoryTools
    }
    // 工具批量调用
    private async batchExecute(cateTools: ToolUseBlock[], concurrent: boolean): Promise<AgentEvent[]> {
        const events: AgentEvent[] = [];
        const taskManger = new ToolExecutManger(this.toolManger, {
            workDir: this.workDir,
        })
        for (const tl of cateTools) {
            //判断工具分类
            const tool = this.toolManger.get(tl.toolName)
            const category = tool?.category ?? "command"
            //是否是读取，读取可以并发读取
            const concurrent = category === "read"
            const decision = this.permissionCheck.check(tl.toolName, category, tl.arguments);
            console.log("🚀 ~ Agent ~ categoryTools ~ decision:", decision)
            if (decision.effect === "deny") {
                //权限拒绝
                events.push({
                    type: "tool_result",
                    toolName: tl.toolName,
                    toolId: tl.toolUseId,
                    output: `Permission denied: ${decision.reason}. 此操作已被安全策略拦截和阻止，请告知用户该命令被拒绝，不要描述该命令会做什么。`,
                    isError: true,
                    elapsed: 0,
                });
                continue;
            }
            if (decision.effect === "ask" && this.onPermissionRequest) {
                const response = await this.onPermissionRequest(
                    tl.toolName,
                    tl.arguments,
                    decision
                );
                if (response === "deny") {
                    events.push({
                        type: "tool_result",
                        toolName: tl.toolName,
                        toolId: tl.toolUseId,
                        output: "Permission denied by user",
                        isError: true,
                        elapsed: 0,
                    });
                    continue;
                }
                if (response === "allowAlways") {
                    this.permissionCheck.allowAlways(tl.toolName, tl.arguments);
                }
            }

            // const tool = this.toolManger.get(tl.toolName);
            taskManger.submit(tl.toolUseId, tl.toolName, tl.arguments);
            //不支持并发，则执行
            if (!concurrent) {
                const result = await taskManger.collectResults()
                for (const r of result) {
                    this.formatToolResult(r, cateTools, events);
                }
            }
        }
        //并发：因为循环的时候已经把所有的任务放进pendingTask了
        const result = await taskManger.collectResults()
        for (const r of result) {
            this.formatToolResult(r, cateTools, events);
        }
        return events;
    }
    //处理调用结果
    private formatToolResult(
        r: { toolId: string; toolName: string; result: { output: string; isError: boolean }; elapsed: number },
        toolUses: ToolUseBlock[],
        events: AgentEvent[],
    ) {
        //通过结果查询到原始的toolUse
        // const originTool = toolUses.find(u => u.toolUseId === r.toolId)
        //TODO: 结果缓存
        events.push({
            type: "tool_result",
            toolName: r.toolName,
            toolId: r.toolId,
            output: r.result.output,
            isError: r.result.isError,
            elapsed: r.elapsed,
        });
    }
}
