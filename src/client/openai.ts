import OpenAI from "openai";
import { loadConfig } from "../config.js";

class OpenAIClient {
    private client: OpenAI;
    private config: any;

    constructor() {
        this.config = loadConfig();
        this.client = new OpenAI({
            apiKey: this.config.apiKey,
            baseURL: this.config.apiUrl
        });
    }

    async sendMessage(message: string): Promise<string> {
        const response: OpenAI.Responses.Response = await this.client.responses.create({
            model: this.config.model,
            input: message
        });
        return response.output_text;
    }
}

export default OpenAIClient;