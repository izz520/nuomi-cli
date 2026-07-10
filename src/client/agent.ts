import { MessageManger } from "../messageManger/message.js";
import { RegisterTools } from "../tools/register.js";
import { AgentEvent } from "../types/agent.js";
import { UsageAnchor } from "../types/compact.js";
import { ToolUseBlock } from "../types/messsage.js";
import { ProviderConfig } from "../types/provider.js";
import writeLog from "../utils/writeLog.js";
import AnthropicClient from "./anthorpic.js";
import createClient from "./create.js";
import OpenAIClient from "./openai.js";
export class Agent {
    private messageManger: MessageManger
    private provider: ProviderConfig
    private client: AnthropicClient | OpenAIClient
    private toolsRegister: RegisterTools
    private usageAnchor: UsageAnchor | null = null;
    constructor(provider: ProviderConfig, messageManget: MessageManger, toolsRegister: RegisterTools) {
        this.provider = provider
        this.client = createClient({ provider: provider })
        this.messageManger = messageManget
        this.toolsRegister = toolsRegister
    }
    //开始循环
    async *startLoop(): AsyncGenerator<AgentEvent> {
        let toolSchemas = this.toolsRegister.getAllSchemas();
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
        const sentMessageCount = this.messageManger.len();

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
            //进行工具分类和并发
            const categoaryTools = this.categoryTools(toolUses)
            //并发
            for (const tool of categoaryTools) {

            }
        }

    }
    //工具分类
    private categoryTools(tools: ToolUseBlock[]) {
        const categoryTools: Array<{ concurrent: boolean; tools: ToolUseBlock[] }> = [];
        //循环全部工具
        for (const tool of tools) {
            //获取工具名
            const toolRegister = this.toolsRegister.get(tool.toolName)
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
}
