import React, { memo, useEffect, useState } from 'react'
import { AssistantMessagePhase } from '../../types/llm.js';
import { Box, Text } from 'ink';
import { Marked, type MarkedExtension } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { symbols } from '../../styles.js';
import LoadingMessage from './LoaidngMessage.js';

const markdownParser = new Marked(
    markedTerminal({
        reflowText: true,
        paragraph: (text: string) => text
    }) as unknown as MarkedExtension
);

type MessageFormat = "plain" | "markdown" | "command";
export type MessagePhase = AssistantMessagePhase | "working" | "thinking" | "tool_call";
export interface ChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
    phase?: MessagePhase;
    format?: MessageFormat;
};
interface MessageProps {
    messages: ChatMessage[];
}


const MessageList = ({ messages }: MessageProps) => {
    // console.log("🚀 ~ MessageList ~ messages:", messages)
    const isShowLoading = messages.length > 0 && messages[messages.length - 1]?.role === "user"
    return (
        <>
            <Box flexDirection="column" marginBottom={1}>
                {messages.map((message, index) => {
                    const content = message.content.replace(/^\r?\n/, "");
                    const renderedContent = (markdownParser.parse(content) as string).trimEnd();
                    //展示消息签名的图标
                    const getIconType = () => {
                        if (message.role === "user") {
                            return symbols.prompt
                        } else {
                            if (message.phase === "thinking") return symbols.thinking
                            if (message.phase === "tool_call") return symbols.tool
                            return symbols.circle
                        }
                    }
                    return (
                        <Box
                            key={index}
                            flexDirection="column"
                            alignItems="flex-start"
                            width="100%"
                            // marginBottom={message.role === "assistant" ? 1 : 0}
                            marginTop={1}
                            backgroundColor={message.role === "user" ? "gray" : undefined}
                        >
                            <Box flexDirection="row" flexShrink={1} flexGrow={1}>
                                <Box width={2} flexShrink={0}>
                                    <Text dimColor={message.phase === "thinking" || message.phase === "tool_call"}>
                                        {getIconType()}
                                    </Text>
                                </Box>
                                <Box flexShrink={1} flexGrow={1}>
                                    <Text dimColor={message.phase === "thinking"}>{renderedContent}</Text>
                                </Box>
                            </Box>
                        </Box>
                    );
                })}
            </Box>
            {isShowLoading && <LoadingMessage />}
        </>

    )
}

export default memo(MessageList)
