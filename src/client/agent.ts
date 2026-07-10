import { MessageManger } from "../messageManger/message.js";
import { RegisterTools } from "../tools/register.js";
import { ProviderConfig } from "../types/provider.js";
import writeLog from "../utils/writeLog.js";
import AnthropicClient from "./anthorpic.js";
import createClient from "./create.js";
import OpenAIClient from "./openai.js";
export class Agent {
    private messageManger: MessageManger
    private provider: ProviderConfig
    private client: AnthropicClient | OpenAIClient
    private toolsRegister: RegisterTools
    constructor(provider: ProviderConfig, messageManget: MessageManger, toolsRegister: RegisterTools) {
        this.provider = provider
        this.client = createClient({ provider: provider })
        this.messageManger = messageManget
        this.toolsRegister = toolsRegister
    }
    //开始循环
    async start(): Promise<void> {
        let toolSchemas = this.toolsRegister.getAllSchemas();
        console.log("进入loop");

        const result = this.client.sendMessageStream(this.messageManger, toolSchemas)
        for await (const message of result) {
            writeLog(message)
        }
    }
}
