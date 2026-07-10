import { Anthropic } from "@anthropic-ai/sdk"
import { StreamEvent } from "../types/llm.js";
import { ProviderConfig } from "../types/provider.js";
import { IMessageManger } from "../types/messsage.js";
import { Tool } from "../types/tools.js";

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



    async *sendMessageStream(messageManger: IMessageManger, tools: Record<string, unknown>[]): AsyncGenerator<StreamEvent> {
        console.log("messageManger", messageManger);
        console.log("tools", tools);
    }
}


export default AnthropicClient;
