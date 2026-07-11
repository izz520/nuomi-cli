import { Anthropic } from "@anthropic-ai/sdk"
import { StreamEvent } from "../types/llm.js";
import { ProviderConfig } from "../types/provider.js";
import { MessageManger } from "../messageManger/message.js";
import writeLog from "../utils/writeLog.js";
import { convortAnthropicMessage } from "./convort-message.js";

class AnthropicClient {
    private client: Anthropic;
    private config: ProviderConfig;
    private systemPrompt: string

    constructor(provider: ProviderConfig, systemPrompt: string) {
        this.client = new Anthropic({
            apiKey: provider.api_key,
            baseURL: provider.base_url
        });
        this.config = provider;
        this.systemPrompt = systemPrompt
    }



    async *sendMessageStream(messageManger: MessageManger, tools: Record<string, unknown>[]): AsyncGenerator<StreamEvent> {
        // console.log("发送消息给Agent");

        //拿到全部消息
        const message = messageManger.getMessages()
        const convrtMessage = convortAnthropicMessage(message)
        // console.log("🚀 ~ AnthropicClient ~ sendMessageStream ~ message:", message)
        // writeLog(convrtMessage)
        //格式化工具为Anthropic支持的格式
        const formatTools: Anthropic.Tool[] = tools.map((s) => {
            const inputSchema = s.input_schema as Record<string, unknown> | undefined;
            return {
                name: s.name as string,
                description: (s.description as string) ?? "",
                input_schema: {
                    type: "object" as const,
                    properties: (inputSchema?.properties as Record<string, unknown>) ?? {},
                    required: (inputSchema?.required as string[]) ?? [],
                },
            };
        });
        //构建参数
        const params = {
            model: this.config.model,
            max_tokens: 1024,
            system: this.systemPrompt,
            messages: convrtMessage,
            stream: true,
            tools: formatTools
        }
        // writeLog(params)
        //发送消息
        const result = this.client.messages.stream(params)
        //思考
        let isThinking = false;
        let thinkingStr = ""
        let thinkingSig = ""
        //回答
        let isAnswer = false;
        let answer = ""
        //工具调用
        let isUseTools = false;
        let tool = {
            toolId: "",
            toolName: "",
            toolJson: ""
        }
        //结束类型
        let stopReason = "end_turn";
        //消耗token
        let inputTokens = 0;
        let outputTokens = 0;
        let cacheReadInputTokens = 0;
        let cacheCreationInputTokens = 0;
        //消费流失输出
        for await (const messageStreamEvent of result) {
            // console.log(messageStreamEvent.type);
            writeLog(messageStreamEvent)
            switch (messageStreamEvent.type) {
                case "message_start": {
                    // console.log(`消息开始,初始输入Token:${messageStreamEvent.message.usage.input_tokens}，输出Token:${messageStreamEvent.message.usage.output_tokens}`);
                    break;
                }
                case "content_block_start": {
                    const block = messageStreamEvent.content_block;
                    if (block.type === "thinking") {
                        //开始思考
                        isThinking = true
                        thinkingStr = ""
                        thinkingSig = ""
                        // console.log("开始思考的内容");
                    }
                    if (block.type === "text") {
                        isAnswer = true
                        answer = ""
                        // console.log("开始回答");
                    }
                    if (block.type === "tool_use") {
                        isUseTools = true
                        tool.toolId = block.id
                        tool.toolName = block.name
                        tool.toolJson = ""
                        // console.log("开始申请调用工具");
                    }
                    break;

                }
                case "content_block_delta": {
                    const delta = messageStreamEvent.delta;
                    if (delta.type === "thinking_delta") {
                        //思考的内容
                        thinkingStr += delta.thinking
                        yield ({
                            type: "thinking_delta",
                            text: delta.thinking
                        })
                        // console.log("思考：", thinkingStr);
                    }
                    if (delta.type === "signature_delta") {
                        //思考之后的签名
                        // console.log("思考文案的签名", delta.signature);
                        thinkingSig = delta.signature
                    }
                    if (delta.type === "text_delta") {
                        //回答的内容
                        answer += delta.text
                        yield ({
                            type: "text_delta",
                            text: delta.text
                        })
                        // console.log("回答：", answer);
                    }
                    if (delta.type === "input_json_delta") {
                        //数据工具参数
                        tool.toolJson += delta.partial_json
                        // console.log("工具调用：", tool.toolJson);
                        yield ({
                            type: "tool_call_delta",
                            text: delta.partial_json
                        });
                    }
                    break;
                }
                case "content_block_stop": {
                    if (isThinking) {
                        //思考结束
                        isThinking = false
                        console.log("思考内容:", thinkingStr);
                        yield ({
                            type: "thinking_complete",
                            thinking: thinkingStr,
                            signature: thinkingSig,
                        })
                        thinkingSig = ""
                        thinkingStr = ""
                    }
                    if (isAnswer) {
                        //回答结束
                        isAnswer = false
                        // console.log("回答:", answer);

                    }
                    if (isUseTools) {
                        //工具调用申请的输出完成
                        isUseTools = false
                        console.log(`工具调用:${tool.toolName}-${tool.toolJson}`);
                        let args: Record<string, unknown> = {};
                        if (tool.toolJson) {
                            try {
                                args = JSON.parse(tool.toolJson);
                            } catch {
                                args = {};
                            }
                        }
                        yield {
                            type: "tool_call_complete",
                            toolId: tool.toolId,
                            toolName: tool.toolName,
                            arguments: args,
                        };
                        tool = {
                            toolId: "",
                            toolName: "",
                            toolJson: ""
                        }

                    }
                    break;
                }
                case "message_delta": {
                    const usage = messageStreamEvent.usage
                    console.log(`本次对话结束，本轮消耗的输入Token:${usage.input_tokens},输出Token:${usage.output_tokens}`);
                    inputTokens = usage.input_tokens ?? 0
                    outputTokens = usage.output_tokens ?? 0
                    cacheCreationInputTokens = usage.cache_creation_input_tokens ?? 0
                    cacheReadInputTokens = usage.cache_read_input_tokens ?? 0
                    break;
                }
                case "message_stop": {
                    // console.log("对话结束");
                    break;
                }
            }
        }
        yield {
            type: "stream_end",
            stopReason,
            usage: {
                inputTokens,
                outputTokens,
                cacheReadInputTokens,
                cacheCreationInputTokens,
            },
        };
    }
}


export default AnthropicClient;
