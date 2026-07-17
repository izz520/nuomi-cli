import { IMessage, ThinkingBlock, ToolResultBlock, ToolUseBlock } from "../types/messsage.js";
/**
 * AI的聊天历史记录
 */
export class MessageManager {
    private history: IMessage[] = []
    private ltmInjected = false
    //添加一个用户消息
    addUserMessage(content: string): void {
        this.history.push({ role: "user", content });
    }
    //添加一个Agent消息
    addAssistantMessage(content: string): void {
        this.history.push({ role: "assistant", content });
    }
    //添加工具调用消息
    addToolUseMessage(
        text: string,
        toolUseId: string,
        toolName: string,
        args: Record<string, unknown>
    ): void {
        this.history.push({
            role: "assistant",
            content: text,
            toolUses: [{ toolUseId, toolName, arguments: args }],
        });
    }
    //添加一个完整的消息
    addAssistantFull(
        text: string,
        thinking: ThinkingBlock[],
        toolUses: ToolUseBlock[]
    ): void {
        this.history.push({
            role: "assistant",
            content: text,
            thinkingBlocks: thinking.length > 0 ? thinking : undefined,
            toolUses: toolUses.length > 0 ? toolUses : undefined,
        });
    }
    //添加一个工具调用结果的消息
    addToolResultMessage(
        toolUseId: string,
        content: string,
        isError: boolean
    ): void {
        this.history.push({
            role: "user",
            content: "",
            toolResults: [{ toolUseId, content, isError }],
        });
    }
    addToolResultsMessage(results: ToolResultBlock[]): void {
        this.history.push({ role: "user", content: "", toolResults: results });
    }
    addSystemReminder(content: string): void {
        this.history.push({
            role: "user",
            content: `<system-reminder>\n${content}\n</system-reminder>`,
        });
    }
    getMessages(): IMessage[] {
        return [...this.history];
    }
    len(): number {
        return this.history.length;
    }
    // 把消息记录替换成压缩后的消息记录
    replaceWithCompacted(summaryContent: string, keep: IMessage[]): void {
        this.history = [
            { role: "user", content: summaryContent },
            ...keep,
        ];
    }
    //拿到指令以及记忆
    injectLongTermMemory(instructions: string, memories: string): void {
        // console.log("hello");

        // console.log("🚀 ~ MessageManager ~ injectLongTermMemory ~ memories:", memories)
        // console.log("🚀 ~ MessageManager ~ injectLongTermMemory ~ instructions:", instructions)
        //如果已经注入过了就跳过
        if (this.ltmInjected) return;
        const sections: string[] = [];
        console.log("🚀 ~ MessageManager ~ injectLongTermMemory ~ instructions:", instructions)
        if (instructions) {
            //指令存在，就把指令添加进来
            sections.push(
                "# nuomiMd\nCodebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.\n\n" +
                instructions
            );
        }
        if (memories) {
            //如果记忆存在，则添加记忆
            sections.push("# autoMemory\n" + memories);
        }
        // console.log("🚀 ~ MessageManager ~ injectLongTermMemory ~ sections:", sections)

        //如果没有任何指令或者记忆，则返回空
        if (sections.length === 0) return;
        //创建当前日期
        const today = new Date().toISOString().split("T")[0];
        // 在片段中加入当前日期
        sections.push(`# currentDate\nToday's date is ${today}.`);

        const body = sections.join("\n\n");
        // 最后通过<system-reminder>包裹内容
        const wrapped =
            "<system-reminder>\nAs you answer the user's questions, you can use the following context:\n" +
            body +
            "\n\n      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.\n</system-reminder>";
        console.log("🚀 ~ MessageManager ~ injectLongTermMemory ~ wrapped:", wrapped)
        //在当前记录的最前面插入一个用户会话，内容就是<system-reminder>包裹的系统提示
        this.history.unshift({ role: "user", content: wrapped });
        //注入记忆标记为true
        this.ltmInjected = true;
    }
}