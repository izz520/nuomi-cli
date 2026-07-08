import OpenAI from "openai";
import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../config.js";
import { Stream } from "openai/streaming";
import { AssistantMessagePhase, StreamEvent } from "../types/llm.js";

type StreamDebugMode = "off" | "compact" | "raw";

class OpenAIClient {
    private client: OpenAI;
    private config: any;
    private streamDebugMode: StreamDebugMode;
    private streamDebugLogPath: string;

    constructor() {
        this.config = loadConfig();
        this.client = new OpenAI({
            apiKey: this.config.apiKey,
            baseURL: this.config.apiUrl
        });
        this.streamDebugMode = this.getStreamDebugMode();
        this.streamDebugLogPath = resolve(process.cwd(), "logs", "openai-stream.log");
    }

    private getStreamDebugMode(): StreamDebugMode {
        const value = process.env.OPENAI_STREAM_DEBUG;

        if (value === "raw" || value === "1") {
            return "raw";
        }

        if (value === "compact") {
            return "compact";
        }

        return "off";
    }

    private logStreamEvent(event: OpenAI.Responses.ResponseStreamEvent) {
        if (this.streamDebugMode === "off") {
            return;
        }

        mkdirSync(resolve(process.cwd(), "logs"), { recursive: true });

        if (this.streamDebugMode === "raw") {
            this.writeStreamLog(`[openai stream raw]\n${JSON.stringify(event, null, 2)}\n`);
            return;
        }

        const itemType = "item" in event ? event.item?.type : undefined;
        const delta = "delta" in event ? event.delta : undefined;

        this.writeStreamLog(
            `[openai stream] type=${event.type}` +
            `${itemType ? ` item.type=${itemType}` : ""}` +
            `${typeof delta === "string" ? ` delta=${JSON.stringify(delta)}` : ""}\n`
        );
    }

    private writeStreamLog(message: string) {
        appendFileSync(this.streamDebugLogPath, message, "utf8");
    }

    private getAssistantMessagePhase(item: unknown): AssistantMessagePhase {
        const phase = (item as Record<string, unknown>).phase;

        if (phase === "commentary" || phase === "final_answer") {
            return phase;
        }

        return "unknown";
    }

    async *sendMessageStream(message: string): AsyncGenerator<StreamEvent> {
        const response: Stream<OpenAI.Responses.ResponseStreamEvent> = await this.client.responses.create({
            model: this.config.model,
            input: message,
            stream: true
        });
        this.logStreamStart(message);
        let currentToolName = "";
        let currentToolId = "";
        let toolArgsStream = "";
        let reasoningId = "";
        let reasoningText = "";
        let inputTokens = 0;
        let outputTokens = 0;
        let cacheReadInputTokens = 0;
        const messagePhases = new Map<string, AssistantMessagePhase>();
        // console.log("🚀 ~ OpenAIClient ~ sendMessage ~ response:", response)
        for await (const event of response) {
            this.logStreamEvent(event);

            // 当普通消息过来的时候
            if (event.type === "response.output_text.delta") {
                yield {
                    type: "text_delta",
                    text: event.delta,
                    itemId: event.item_id,
                    outputIndex: event.output_index,
                    contentIndex: event.content_index,
                    phase: messagePhases.get(event.item_id),
                };
                // 当思考过程的消息过来的时候
            } else if (event.type === "response.reasoning_summary_text.delta") {
                // 累积思考过程的文本
                reasoningText += event.delta;
                yield { type: "thinking_delta", text: event.delta };
                //思考完成事件
            } else if (event.type === "response.reasoning_summary_text.done") {
                //再向上上报思考的整个文案
                yield { type: "thinking_complete", thinking: reasoningText, signature: reasoningId };
                // 工具调用开始
            } else if (event.type === "response.function_call_arguments.delta") {
                //工具参数也是流式传输过来的，所以先暂存起来，等传输完成了，就获取了工具的完整参数
                toolArgsStream += event.delta;
                yield { type: "tool_call_delta", text: event.delta };
                //outinput结构新增条目的时候会出发
            } else if (event.type === "response.output_item.added") {
                // 模型确定了要调用的工具
                if (event.item.type === "function_call") {
                    currentToolName = event.item.name ?? "";
                    currentToolId = event.item.call_id ?? "";
                    toolArgsStream = "";
                    yield { type: "tool_call_start", toolName: currentToolName, toolId: currentToolId };
                } else if (event.item.type === "message") {
                    const phase = this.getAssistantMessagePhase(event.item);

                    messagePhases.set(event.item.id, phase);
                    // yield {
                    //     type: "assistant_message_start",
                    //     itemId: event.item.id,
                    //     outputIndex: event.output_index,
                    //     phase,
                    // };
                } else if ((event.item as unknown as Record<string, unknown>).type === "reasoning") {
                    reasoningId = (event.item as unknown as Record<string, unknown>).id as string ?? "";
                    reasoningText = "";
                }
                //工具流式输出结束
            } else if (event.type === "response.output_item.done") {
                if (event.item.type === "function_call" && currentToolName) {
                    //拿到要调用的工具的参数了，解析成json对象
                    let args: Record<string, unknown> = {};
                    try { args = JSON.parse(toolArgsStream); } catch { args = {}; }
                    yield { type: "tool_call_complete", toolId: currentToolId, toolName: currentToolName, arguments: args };
                    currentToolName = "";
                    currentToolId = "";
                    toolArgsStream = "";
                }
                //流式输出结束事件
            } else if (event.type === "response.completed") {
                const usage = event.response.usage;
                if (usage) {
                    outputTokens = usage.output_tokens ?? 0;
                    // Responses API exposes the cached prefix via
                    // input_tokens_details.cached_tokens; absent → 0. There is no
                    // cache_creation concept here, so it stays 0.
                    cacheReadInputTokens = usage.input_tokens_details?.cached_tokens ?? 0;
                    // input_tokens already includes the cached prefix; subtract so the
                    // usage anchor (input + cache_read) doesn't double-count it.
                    inputTokens = Math.max(0, (usage.input_tokens ?? 0) - cacheReadInputTokens);
                }

                // Parse the actual stop reason from the Responses API. When the
                // response status is "incomplete", check incomplete_details.reason
                // for "max_output_tokens" so the agent loop's max_tokens recovery
                // can trigger. Otherwise default to "end_turn".
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

    private logStreamStart(message: string) {
        if (this.streamDebugMode === "off") {
            return;
        }

        mkdirSync(resolve(process.cwd(), "logs"), { recursive: true });
        this.writeStreamLog(
            `\n[openai stream start] ${new Date().toISOString()}\n` +
            `[input] ${JSON.stringify(message)}\n`
        );
    }
}

export default OpenAIClient;
