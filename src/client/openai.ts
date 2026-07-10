import OpenAI from "openai";
import { Stream } from "openai/streaming";
import { AssistantMessagePhase, StreamEvent } from "../types/llm.js";
import { ProviderConfig } from "../types/provider.js";
import { IMessageManger } from "../types/messsage.js";
import { Tool } from "../types/tools.js";

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

    async *sendMessageStream(messageManger: IMessageManger, tools: Record<string, unknown>[]): AsyncGenerator<StreamEvent> {
        console.log("messageManger", messageManger);
        console.log("tools", tools);
    }
}

export default OpenAIClient;
