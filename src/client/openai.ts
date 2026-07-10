import OpenAI from "openai";
import { Stream } from "openai/streaming";
import { AssistantMessagePhase, StreamEvent } from "../types/llm.js";
import { ProviderConfig } from "../types/provider.js";
import { IMessage } from "../types/messsage.js";
import { Tool } from "../types/tools.js";
import { MessageManger } from "../messageManger/message.js";
import writeLog from "../utils/writeLog.js";

class OpenAIClient {
    private client: OpenAI;
    private config: any;

    constructor(provider: ProviderConfig, systemPrompt: string) {
        this.config = provider;
        this.client = new OpenAI({
            apiKey: provider.api_key,
            baseURL: provider.base_url
        });
    }

    private getAssistantMessagePhase(item: unknown): AssistantMessagePhase {
        const phase = (item as Record<string, unknown>).phase;

        if (phase === "commentary" || phase === "final_answer") {
            return phase;
        }

        return "unknown";
    }

    async *sendMessageStream(messageManger: MessageManger, tools: Record<string, unknown>[]): AsyncGenerator<StreamEvent> {
        writeLog("Openai:", messageManger.getMessages())
    }
}

export default OpenAIClient;
