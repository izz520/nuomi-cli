import { MessageManger } from "../messageManger/message.js";
import { ToolsManger } from "../tools/register.js";
import { AgentEvent } from "../types/agent.js";
import { UsageAnchor } from "../types/compact.js";
import { ToolResultBlock, ToolUseBlock } from "../types/messsage.js";
import { ProviderConfig } from "../types/provider.js";
import writeLog from "../utils/writeLog.js";
import AnthropicClient from "./anthorpic.js";
import createClient from "./create.js";
import OpenAIClient from "./openai.js";
import { ToolExecutManget } from "./tool-execut-manget.js";

// value, then attempt a bounded number of multi-turn recoveries. Mirrors Go.
const MAX_TOKENS_CEILING = 64000;
const MAX_OUTPUT_TOKENS_RECOVERIES = 3;
// Hard per-result cap on tool output stored back into the conversation. The
// toolresult budget handles spilling separately; this is a final safety cap.
const MAX_OUTPUT_CHARS = 10000;
export class Agent {
    private messageManger: MessageManger
    private client: AnthropicClient | OpenAIClient
    private toolManger: ToolsManger
    private usageAnchor: UsageAnchor | null = null;
    private workDir: string;
    constructor(client: AnthropicClient | OpenAIClient, messageManger: MessageManger, toolManger: ToolsManger, workDir: string) {
        this.client = client
        this.messageManger = messageManger
        this.toolManger = toolManger
        this.workDir = workDir
    }
    //开始循环
    async *startLoop(): AsyncGenerator<AgentEvent> {
        let toolSchemas = this.toolManger.getAllSchemas();
        // console.log("🚀 ~ Agent ~ startLoop ~ toolSchemas:", toolSchemas)
        let looping = true;
        //开始循环Loop
        while (looping) {
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
            //拿到当前的会话token总数
            const sentMessageCount = this.messageManger.len();
            //记录工具调用次数
            let consecutiveUnknown = 0;
            const result = this.client.sendMessageStream(this.messageManger, toolSchemas)
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
                        // Record the real-token anchor: the full context size the API
                        // just reported (input + cache_read + cache_creation + output)
                        // plus the message count it covered. The next manageContext()
                        // trusts this baseline and only char-estimates the tail beyond it.
                        this.usageAnchor = {
                            baselineTokens:
                                message.usage.inputTokens +
                                message.usage.cacheReadInputTokens +
                                message.usage.cacheCreationInputTokens +
                                message.usage.outputTokens,
                            anchorCount: sentMessageCount,
                        };
                        yield { type: "usage", usage: message.usage };
                        break;
                    }
                }
            }
            //把本次AI回答的问题加入到会话管理器中
            this.messageManger.addAssistantFull(answer, thinkingBlocks, toolUses);
            //判断是否有工具调用
            if (toolUses.length > 0) {
                console.log("有工具调用");

                //进行工具分类和并发
                const categoaryTools = this.categoryTools(toolUses)
                console.log("🚀 ~ Agent ~ startLoop ~ categoaryTools:", categoaryTools)
                //总的结果
                const toolTotalOrignResult: AgentEvent[] = []
                //并发
                for (const cateTool of categoaryTools) {
                    //拿到当前分类下所有工具结果
                    const cateResults = await this.batchExecute(cateTool.tools, cateTool.concurrent)
                    toolTotalOrignResult.push(...cateResults)
                }
                console.log("🚀 ~ Agent ~ startLoop ~ toolTotalOrignResult:", toolTotalOrignResult)

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
                this.messageManger.addToolResultsMessage(toolResults);
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
            //判断工具名称
            const concurrent = (toolRegister?.category ?? "command") === "read"
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
        const taskManger = new ToolExecutManget(this.toolManger, {
            workDir: this.workDir,
        })
        for (const tl of cateTools) {
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
