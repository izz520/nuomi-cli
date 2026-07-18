import OpenAI from "openai";
import { AssistantMessagePhase, StreamEvent, StreamOptions } from "../types/llm.js";
import { ProviderConfig } from "../types/provider.js";
import { IMessage } from "../types/messsage.js";
import { Tool } from "../types/tools.js";
import { MessageManager } from "../messageManager/message.js";
import writeLog from "../utils/writeLog.js";
import { convortOpenAIMessage } from "./convort-message.js";
import { EasyInputMessage } from "openai/resources/responses/responses.js";

class OpenAIClient {
    private client: OpenAI;
    private config: ProviderConfig;
    private systemPrompt: string

    constructor(provider: ProviderConfig, systemPrompt: string) {
        this.config = provider;
        this.client = new OpenAI({
            apiKey: provider.api_key,
            baseURL: provider.base_url
        });
        this.systemPrompt = systemPrompt
    }

    getSystemPrompt(): string {
        return this.systemPrompt;
    }

    async *sendMessageStream(messageManager: MessageManager, tools: Record<string, unknown>[], options: StreamOptions = {}): AsyncGenerator<StreamEvent> {
        //拿到消息管理器的所有消息记录
        const input = buildOpenAIRequestInput(
            this.systemPrompt,
            messageManager.getMessages(),
            options.runtimeContext,
        )
        // 格式化OpenAI支持的工具格式
        const formatTools: OpenAI.Responses.FunctionTool[] = tools.map((s) => {
            const schema = s.input_schema as Record<string, unknown>;
            return {
                type: "function" as const,
                name: s.name as string,
                description: (s.description as string) ?? "",
                parameters: schema,
                strict: false,
            };
        });
        //构造params参数
        const params: OpenAI.Responses.ResponseCreateParamsStreaming = {
            model: this.config.model,
            input,
            stream: true,
            max_output_tokens: 8192,
            ...(formatTools.length > 0 ? { tools: formatTools } : {}),
        };
        // console.log("🚀 ~ OpenAIClient ~ sendMessageStream ~ params:", params)
        const result = await this.client.responses.create(params, { signal: options.abortSignal ?? null })
        // console.log("🚀 ~ OpenAIClient ~ sendMessageStream ~ result:", result)
        //是注释
        let isThinking = false
        let thinkingStr = ""
        //内容
        let isAnswer = false
        let answer = ""
        //函数调用
        let isUseTools
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
        for await (const event of result) {
            writeLog(event)
            switch (event.type) {
                // 标记输出开始
                case 'response.output_item.added': {
                    const item = event.item
                    if (event.item.type === "message") {
                        if (event.item.phase === "commentary") {
                            //标记开始生成注释的内容
                            // console.log("开始思考");

                            isThinking = true;
                            break;
                        }
                        if (event.item.phase === "final_answer") {
                            // 标记正文输出的开始
                            // console.log("开始输出正文");

                            isAnswer = true;
                            break;
                        }
                    }
                    if (event.item.type === "function_call") {
                        //标记开始生成函数调用的内容
                        // console.log("开始生成工具调用");

                        isUseTools = true;
                        tool.toolId = event.item.call_id
                        tool.toolName = event.item.name
                        yield ({
                            type: "tool_call_start",
                            toolId: tool.toolId,
                            toolName: tool.toolName
                        })
                        break;
                    }
                    break;
                }
                // 内容持续输出
                case "response.output_text.delta": {
                    if (isAnswer) {
                        //正文回复的内容
                        // console.log("回答的内容:", event.delta);

                        answer += event.delta
                        yield ({
                            type: "text_delta",
                            text: event.delta
                        })
                        break;
                    }
                    if (isThinking) {
                        // console.log("思考的内容:", event.delta);
                        //是思考的内容
                        thinkingStr += event.delta
                        yield ({
                            type: "thinking_delta",
                            text: event.delta
                        })
                        break;
                    }
                    break;
                }
                //函数调用的参数
                case 'response.function_call_arguments.delta': {
                    // console.log("工具调用参数:", event.delta);
                    tool.toolJson += event.delta
                    yield ({
                        type: "tool_call_delta",
                        text: event.delta
                    })
                    break
                }
                //输出结束
                case 'response.output_item.done': {
                    const item = event.item;
                    if (item.type === "message" && item.phase === "commentary") {
                        // console.log("思考结束", thinkingStr);

                        //思考结束
                        isThinking = false
                        thinkingStr = ""
                        yield ({
                            type: "thinking_complete",
                            thinking: thinkingStr,
                            signature: "",
                        })
                        break;
                    }
                    if (item.type === "message" && item.phase === "final_answer") {
                        //回答内容结束
                        // console.log("回答结束:", answer);
                        isAnswer = false
                        answer = ""
                        break;
                    }
                    if (item.type === "function_call") {
                        //工具调用输出参数完成
                        console.log(`工具调用：${tool.toolName}-${tool.toolJson}`);

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
                        break;
                    }
                    break;
                }
                //计算消耗的token
                case 'response.completed': {
                    const usage = event.response.usage;
                    if (usage) {
                        outputTokens = usage.output_tokens ?? 0;
                        cacheReadInputTokens = usage.input_tokens_details?.cached_tokens ?? 0;
                        inputTokens = Math.max(0, (usage.input_tokens ?? 0) - cacheReadInputTokens);
                    }
                    let stopReason = "end_turn";
                    const resp = event.response as unknown as Record<string, unknown>;
                    if (resp.status === "incomplete") {
                        const details = resp.incomplete_details as Record<string, unknown> | undefined;
                        if (details?.reason === "max_output_tokens") {
                            stopReason = "max_tokens";
                        }
                    }

                    yield {
                        type: "stream_end",
                        stopReason,
                        usage: {
                            inputTokens,
                            outputTokens,
                            cacheReadInputTokens,
                            cacheCreationInputTokens: 0,
                        },
                    };
                }
            }
        }
    }
}

export function buildOpenAIRequestInput(
    systemPrompt: string,
    history: IMessage[],
    runtimeContext?: string,
): OpenAI.Responses.ResponseInputItem[] {
    const input: OpenAI.Responses.ResponseInputItem[] = [
        { role: "system", content: systemPrompt },
    ];
    if (runtimeContext) {
        input.push({ role: "user", content: runtimeContext });
    }
    for (const message of convortOpenAIMessage(history)) {
        input.push(message as unknown as OpenAI.Responses.ResponseInputItem);
    }
    return input;
}

export default OpenAIClient;
