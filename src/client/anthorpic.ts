import { Anthropic } from "@anthropic-ai/sdk"
import { loadConfig } from "../config.js";
import type { Message } from "@anthropic-ai/sdk/resources/messages";

class AnthropicClient {
    private client: Anthropic;
    private config: any;

    constructor() {
        const config = loadConfig();

        this.client = new Anthropic({
            apiKey: config.apiKey,
            baseURL: config.apiUrl
        });
        this.config = config;
    }

    async sendMessage(message: string): Promise<string> {
        const response: Message = await this.client.messages.create({
            model: this.config.model,
            max_tokens: 1024,
            messages: [{ role: "user", content: message }]
        });
        console.log("🚀 ~ AnthropicClient ~ sendMessage ~ response:", response)

        return response.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n");
    }
}

export default AnthropicClient;
