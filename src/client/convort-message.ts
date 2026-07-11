import Anthropic from "@anthropic-ai/sdk";
import { IMessage } from "../types/messsage.js";

export const convortAnthropicMessage = (messages: IMessage[]): Anthropic.MessageParam[] => {
    const convortMessage: Anthropic.MessageParam[] = [];
    for (const message of messages) {

        if (message.role === "assistant") {
            const blocks: Anthropic.ContentBlockParam[] = [];
            //r如果是思考的内容
            if (message.thinkingBlocks) {
                //则循环思考的内容，加进blocks
                for (const tb of message.thinkingBlocks) {
                    blocks.push({
                        type: "thinking",
                        thinking: tb.thinking,
                        signature: tb.signature,
                    });
                }
            }
            //如果是普通消息
            if (message.content) {
                blocks.push({ type: "text", text: message.content });
            }
            //如果说有工具
            if (message.toolUses) {
                //把全部工具放回去
                for (const tu of message.toolUses) {
                    blocks.push({
                        type: "tool_use",
                        id: tu.toolUseId,
                        name: tu.toolName,
                        input: tu.arguments,
                    });
                }
            }
            //如果都不存在
            blocks.push({
                "text": "",
                type: "text"
            })
            convortMessage.push({ role: "assistant", content: blocks })
        } else if (message.toolResults && message.toolResults.length > 0) {
            //是用户，并且有工具调用结果的
            const blocks: Anthropic.ToolResultBlockParam[] = [];
            for (const tr of message.toolResults) {
                blocks.push({
                    type: "tool_result",
                    tool_use_id: tr.toolUseId,
                    is_error: tr.isError,
                    content: tr.content,
                });
            }
            //最后Push进Result
            convortMessage.push({ role: "user", content: blocks });
        } else {
            let canMerge = false;
            if (convortMessage.length > 0) {
                //拿到上一条消息
                const prev = convortMessage[convortMessage.length - 1];
                //如果上一条是用户，并且上一条的内容是数组，并且第一个不是工具调用结果
                if (
                    prev.role === "user" &&
                    Array.isArray(prev.content) &&
                    prev.content.length > 0 &&
                    (prev.content[0] as unknown as Record<string, unknown>).type !== "tool_result"
                ) {
                    //表示能合并
                    canMerge = true;
                }
            }
            if (canMerge) {
                //直接在上一个消息体里面加
                (convortMessage[convortMessage.length - 1].content as Anthropic.TextBlockParam[]).push({
                    type: "text",
                    text: message.content,
                });
            } else {
                //单独添加一条消息
                convortMessage.push({
                    role: "user",
                    content: [{ type: "text", text: message.content }],
                });
            }
        }

    }
    return convortMessage
}