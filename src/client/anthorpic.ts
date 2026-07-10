import { Anthropic } from "@anthropic-ai/sdk"
import { StreamEvent } from "../types/llm.js";
import { ProviderConfig } from "../types/provider.js";
import { MessageManger } from "../messageManger/message.js";
import writeLog from "../utils/writeLog.js";

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
        console.log("发送消息给Agent");

        //拿到全部消息
        const message = messageManger.getMessages()
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
            messages: message,
            stream: true,
            tools: formatTools
        }
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
        //消费流失输出
        for await (const messageStreamEvent of result) {
            // console.log(messageStreamEvent.type);
            writeLog(messageStreamEvent)
            switch (messageStreamEvent.type) {
                case "message_start": {
                    console.log(`消息开始,初始输入Token:${messageStreamEvent.message.usage.input_tokens}，输出Token:${messageStreamEvent.message.usage.output_tokens}`);
                    break;
                }
                case "content_block_start": {
                    const block = messageStreamEvent.content_block;
                    if (block.type === "thinking") {
                        isThinking = true
                        thinkingStr = ""
                        thinkingSig = ""
                        console.log("接下来输出的是思考的内容");
                    }
                    if (block.type === "text") {
                        isAnswer = true
                        answer = ""
                        console.log("接下来是回答的内容");
                    }
                    if (block.type === "tool_use") {
                        isUseTools = true
                        tool.toolId = block.id
                        tool.toolName = block.name
                        tool.toolJson = ""
                        console.log("接下来是工具调用");
                    }
                    break;

                }
                case "content_block_delta": {
                    const delta = messageStreamEvent.delta;
                    if (delta.type === "thinking_delta") {
                        thinkingStr += delta.thinking
                        // console.log("思考：", thinkingStr);
                    }
                    if (delta.type === "signature_delta") {
                        console.log("思考文案的签名", delta.signature);
                        thinkingSig = delta.signature
                    }
                    if (delta.type === "text_delta") {
                        answer += delta.text
                        // console.log("回答：", answer);
                    }
                    if (delta.type === "input_json_delta") {
                        tool.toolJson += delta.partial_json
                        // console.log("工具调用：", tool.toolJson);
                    }
                    break;
                }
                case "content_block_stop": {
                    if (isThinking) {
                        isThinking = false
                        console.log("思考内容:", thinkingStr);

                    }
                    if (isAnswer) {
                        isAnswer = false
                        console.log("回答:", answer);
                    }
                    if (isUseTools) {
                        isUseTools = false
                        console.log(`工具调用:${tool.toolName}-${tool.toolJson}`);

                    }
                    break;
                }
                case "message_delta": {
                    const usage = messageStreamEvent.usage
                    console.log(`本次对话结束，本轮消耗的输入Token:${usage.input_tokens},输出Token:${usage.output_tokens}`);
                    break;
                }
                case "message_stop": {
                    console.log("对话结束");
                    break;
                }
            }
        }
    }
}


export default AnthropicClient;
