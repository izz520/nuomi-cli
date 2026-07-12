import OpenAI from "openai";
import { Stream } from "openai/streaming";
import { AssistantMessagePhase, StreamEvent } from "../types/llm.js";
import { ProviderConfig } from "../types/provider.js";
import { IMessage } from "../types/messsage.js";
import { Tool } from "../types/tools.js";
import { MessageManger } from "../messageManger/message.js";
import writeLog from "../utils/writeLog.js";
import { convortOpenAIMessage } from "./convort-message.js";

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

    async *sendMessageStream(messageManger: MessageManger, tools: Record<string, unknown>[]): AsyncGenerator<StreamEvent> {
        //拿到消息管理器的所有消息记录
        const formatMessages = convortOpenAIMessage(messageManger.getMessages())
        //格式化成OpenAi格式的消息
        const input: OpenAI.Responses.ResponseCreateParamsStreaming["input"] = [];
        //向消息的第一条添加system系统提示词
        input.push({ role: "system" as const, content: this.systemPrompt });
        for (const msg of formatMessages) {
            //循环把消息管理器的消息添加进去
            input.push(msg as unknown as OpenAI.Responses.ResponseInputItem);
        }
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
            ...(formatTools.length > 0 ? { formatTools } : {}),
        };
        console.log("🚀 ~ OpenAIClient ~ sendMessageStream ~ params:", params)
        const result = await this.client.responses.create(params)
        console.log("🚀 ~ OpenAIClient ~ sendMessageStream ~ result:", result)
        for await (const event of result) {
            writeLog(event)
        }
    }
}

export default OpenAIClient;
