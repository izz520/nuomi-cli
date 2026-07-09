import { Anthropic } from "@anthropic-ai/sdk"
import type { MessageParam, ToolUseBlockParam } from "@anthropic-ai/sdk/resources/messages/messages.js";
import { StreamEvent } from "../types/llm.js";
import { readFileTool } from "../tools/ReadFile.js";
import { ProviderConfig } from "../types/provider.js";

class AnthropicClient {
    private client: Anthropic;
    private config: any;
    private systemPrompt: string

    constructor(provider: ProviderConfig, systemPrompt: string) {
        this.client = new Anthropic({
            apiKey: provider.api_key,
            baseURL: provider.base_url
        });
        this.config = provider;
        this.systemPrompt = systemPrompt
    }



    async *sendMessageStream(message: string): AsyncGenerator<StreamEvent> {
        yield* this.streamMessages(
            [{ role: "user", content: message }]
        );
    }

    async *sendToolResultStream(
        originalMessage: string,
        toolUse: ToolUseBlockParam,
        toolResult: string,
        isError = false
    ): AsyncGenerator<StreamEvent> {
        yield* this.streamMessages(
            [
                { role: "user", content: originalMessage },
                { role: "assistant", content: [toolUse] },
                {
                    role: "user",
                    content: [
                        {
                            type: "tool_result",
                            tool_use_id: toolUse.id,
                            content: toolResult,
                            is_error: isError
                        }
                    ]
                }
            ],
        );
    }

    private async *streamMessages(
        messages: MessageParam[]
    ): AsyncGenerator<StreamEvent> {

        let inputTokens = 0;
        let outputTokens = 0;
        let cacheReadInputTokens = 0;
        let cacheCreationInputTokens = 0;
        let stopReason = "end_turn";

        let currentToolName = "";
        let currentToolId = "";
        let jsonAccum = "";
        let thinkingAccum = "";
        let thinkingSignature = "";
        let inThinking = false;

        const response = this.client.messages.stream({
            model: this.config.model,
            max_tokens: 1024,
            messages,
            stream: true,
            tools: [readFileTool],
            system: [
                {
                    type: "text",
                    text: this.systemPrompt,
                    cache_control: { type: "ephemeral" },
                },
            ],
        });


        //循坏消费LLM返回的流式事件
        for await (const messageStreamEvent of response) {
            //判断事件类型，处理不同的流式事件
            switch (messageStreamEvent.type) {
                //会话开始
                case "message_start": {
                    if (messageStreamEvent.message.usage) {
                        inputTokens = messageStreamEvent.message.usage.input_tokens;
                        outputTokens = messageStreamEvent.message.usage.output_tokens;
                        cacheReadInputTokens =
                            messageStreamEvent.message.usage.cache_read_input_tokens ?? 0;
                        cacheCreationInputTokens =
                            messageStreamEvent.message.usage.cache_creation_input_tokens ?? 0;
                    }
                    break;
                }
                //新内容开始
                case "content_block_start": {
                    const block = messageStreamEvent.content_block;
                    //如果content_block是thinking，则表示接下来的内容是思考过程的内容
                    if (block.type === "thinking") {
                        inThinking = true;
                        thinkingAccum = "";
                        thinkingSignature = "";
                    } else if (block.type === "text") {
                        //正文开始
                        // TODO：标记正文内容开始
                        // yield { type: "assistant_message_start", itemId: block.id, phase: "unknown" };

                    } else if (block.type === "tool_use") {
                        currentToolId = block.id
                        currentToolName = block.name
                        jsonAccum = "";
                    }
                    break;
                }
                //内容输出
                case "content_block_delta": {
                    //获取delta内容
                    const delta = messageStreamEvent.delta;
                    //如果delta.type是thinking_delta，则表示这是思考过程的内容
                    if (delta.type === "thinking_delta") {
                        thinkingAccum += delta.thinking;
                        yield { type: "thinking_delta", text: delta.thinking };
                        // 思考内容的签名
                    } else if (delta.type === "signature_delta") {
                        // TODO：处理signature_delta
                        // 可能后面会用到，这个签名是思考过程的一个校验
                        thinkingSignature = delta.signature;
                        //正文的输出内容 
                    } else if (delta.type === "text_delta") {
                        yield { type: "text_delta", text: delta.text };
                    } else if (delta.type === "input_json_delta") {
                        jsonAccum += delta.partial_json;
                        yield { type: "tool_call_delta", text: delta.partial_json };
                    }
                    break;
                }
                //输出结束的标记
                case "content_block_stop": {
                    //思考为True的话，表示思考完成
                    if (inThinking) {
                        yield {
                            type: "thinking_complete",
                            thinking: thinkingAccum,
                            signature: thinkingSignature,
                        };
                        inThinking = false;
                    }
                    //工具的名称存在，表示工具和参数输出完成了
                    if (currentToolName) {
                        let args: Record<string, unknown> = {};
                        if (jsonAccum) {
                            try {
                                args = JSON.parse(jsonAccum);
                            } catch {
                                args = {};
                            }
                        }
                        const toolUse: ToolUseBlockParam = {
                            type: "tool_use",
                            id: currentToolId,
                            name: currentToolName,
                            input: args
                        };

                        yield {
                            type: "tool_call_complete",
                            toolId: currentToolId,
                            toolName: currentToolName,
                            arguments: args,
                            context: {
                                provider: "anthropic",
                                toolUse
                            }
                        };
                        currentToolName = "";
                        currentToolId = "";
                        jsonAccum = "";
                    }
                    break;
                }

                //本次流式输出的结束事件以及token消耗情况
                case "message_delta": {
                    //为什么停止生成了
                    /**
                     * 通常的值为:
                     * end_turn:本轮对话结束
                     * max_tokens：到达了最大token限制
                     * tool_use：等待工具调用的结果
                     * stop_sequence：命中了配置的top sequence 停止序列
                     * pause_turn: 暂停本轮对话
                     * refusal: 模型拒绝生成内容
                     */
                    if (messageStreamEvent.delta.stop_reason) {
                        stopReason = messageStreamEvent.delta.stop_reason;
                    }
                    //获取本次流式输出的token消耗情况
                    if (messageStreamEvent.usage) {
                        outputTokens = messageStreamEvent.usage.output_tokens;
                        if ((messageStreamEvent.usage as any).input_tokens) {
                            inputTokens = (messageStreamEvent.usage as any).input_tokens;
                        }
                        if ((messageStreamEvent.usage as any).cache_read_input_tokens) {
                            cacheReadInputTokens = (messageStreamEvent.usage as any).cache_read_input_tokens;
                        }
                        if ((messageStreamEvent.usage as any).cache_creation_input_tokens) {
                            cacheCreationInputTokens = (messageStreamEvent.usage as any).cache_creation_input_tokens;
                        }
                    }
                    break;
                }
            }
        }
        //整个流式输出结束，返回最终的token消耗情况
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
