import Anthropic from "@anthropic-ai/sdk";
import { IMessage } from "../types/messsage.js";
import OpenAI from "openai";

// 把消息列表转变成Anthropic支持的
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

//把消息列表转变成OpenAI Compact支持的
export const convortOpenAiCompactMessage = (messages: IMessage[]): OpenAI.ChatCompletionMessageParam[] => {
    const formatMessages: OpenAI.ChatCompletionMessageParam[] = []
    for (const message of messages) {
        // 拼接 thinking blocks 为 reasoning_content（DeepSeek/小米等 provider 要求）
        const reasoning = message.thinkingBlocks?.map((tb) => tb.thinking).join("") ?? "";
        //是否有请求的工具调用
        if (message.toolUses && message.toolUses?.length > 0) {
            //构造有工具调用的消息
            const msg: Record<string, unknown> = {
                role: "assistant",
                content: message.content || null,
                tool_calls: message.toolUses?.map((tu) => ({
                    id: tu.toolUseId,
                    type: "function" as const,
                    function: { name: tu.toolName, arguments: JSON.stringify(tu.arguments) },
                })),
            };
            //有思考，则把思考的内容也加进去
            if (reasoning) msg.reasoning_content = reasoning;
            formatMessages.push(msg as unknown as OpenAI.ChatCompletionMessageParam);
        } else if (message.toolResults && message.toolResults.length > 0) {
            //如果是工具调用的结果
            for (const tr of message.toolResults) {
                //循环push进工具调用结果，注意：role为tool
                formatMessages.push({ role: "tool", tool_call_id: tr.toolUseId, content: tr.content });
            }
        } else if (message.role === "assistant") {
            //如果是AI回复的普通消息，直接push
            const msg: Record<string, unknown> = { role: "assistant", content: message.content };
            if (reasoning) msg.reasoning_content = reasoning;
            formatMessages.push(msg as unknown as OpenAI.ChatCompletionMessageParam);
        } else {
            //系统消息或者是用户的消息
            formatMessages.push({ role: message.role === "system" ? "system" : "user", content: message.content });
        }

    }
    return formatMessages
}

export const convortOpenAIMessage = (messages: IMessage[]) => {
    const formatMessages: Record<string, unknown>[] = [];
    for (const m of messages) {
        if (m.thinkingBlocks) {
            //如果是思考的内容
            for (const tb of m.thinkingBlocks) {
                formatMessages.push({
                    type: "reasoning",
                    id: tb.signature,
                    summary: [{ type: "summary_text", text: tb.thinking }],
                });
            }
        }
        //有工具调用请求
        if (m.toolUses && m.toolUses.length > 0) {
            if (m.content) {
                formatMessages.push({ role: "assistant", content: m.content });
            }
            for (const tu of m.toolUses) {
                formatMessages.push({
                    type: "function_call",
                    name: tu.toolName,
                    call_id: tu.toolUseId,
                    arguments: JSON.stringify(tu.arguments),
                });
            }
        } else if (m.toolResults && m.toolResults.length > 0) {
            //有工具调用结果
            for (const tr of m.toolResults) {
                //循环加入到消息中
                formatMessages.push({
                    type: "function_call_output",
                    call_id: tr.toolUseId,
                    output: tr.content,
                });
            }
        } else {
            //普通消息
            formatMessages.push({ role: m.role, content: m.content });
        }
    }
    return formatMessages
}

