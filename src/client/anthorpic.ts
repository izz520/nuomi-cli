import { Anthropic } from "@anthropic-ai/sdk"
import { StreamEvent } from "../types/llm.js";
import { ProviderConfig } from "../types/provider.js";
import { MessageManger } from "../messageManger/message.js";

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
        //消费流失输出
        for await (const messageStreamEvent of result) {
            console.log(messageStreamEvent.type);
        }
    }
}


export default AnthropicClient;
