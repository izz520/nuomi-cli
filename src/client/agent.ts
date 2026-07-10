import { RegisterTools } from "../tools/register.js";
import { IMessageManger } from "../types/messsage.js";
import { ProviderConfig } from "../types/provider.js";
import AnthropicClient from "./anthorpic.js";
import createClient from "./create.js";
import OpenAIClient from "./openai.js";
export class Agent {
    private messageManger: IMessageManger
    private provider: ProviderConfig
    private client: AnthropicClient | OpenAIClient
    private toolsRegister: RegisterTools
    constructor(provider: ProviderConfig, messageManget: IMessageManger, toolsRegister: RegisterTools) {
        this.provider = provider
        this.client = createClient({ provider: provider })
        this.messageManger = messageManget
        this.toolsRegister = toolsRegister
    }
    //开始循环
    async *start() {
        let loop = true;
        let toolSchemas = this.toolsRegister.getAllSchemas();
        while (loop) {
            this.client.sendMessageStream(this.messageManger, toolSchemas)
        }
    }
}