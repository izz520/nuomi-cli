import { IMessage, ThinkingBlock, ToolResultBlock, ToolUseBlock } from "../types/messsage.js";
/**
 * AI的聊天历史记录
 */
export class MessageManager {
    private history: IMessage[] = []
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
}
