import React, { memo, useEffect, useState } from 'react'
import { AssistantMessagePhase } from '../types/llm.js';
import { Box, Text } from 'ink';
import { Marked, type MarkedExtension } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { symbols } from '../styles.js';

const markdownParser = new Marked(
    markedTerminal({
        reflowText: true,
        paragraph: (text: string) => text
    }) as unknown as MarkedExtension
);

type MessageFormat = "plain" | "markdown" | "command";
type MessagePhase = AssistantMessagePhase | "working" | "thinking" | "tool_call";
export interface ChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
    phase?: MessagePhase;
    format?: MessageFormat;
};
interface MessageProps {
    messages: ChatMessage[];
}

// Loading的效果
const LoadingMessage = ({ label }: { label?: string }) => {
    const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

    const [frame, setFrame] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => {
            setFrame(previous => previous + 1);
        }, 80);

        return () => {
            clearInterval(timer);
        };
    }, []);

    return (
        <Box flexDirection="row" flexShrink={1} flexGrow={1}>
            <Box width={2} flexShrink={0}>
                <Text color="gray">{spinnerFrames[frame % spinnerFrames.length]}</Text>
            </Box>
            <Box flexShrink={1} flexGrow={1}>
                <Text color="gray">{label}</Text>
            </Box>
        </Box>
    );
};

const MessageList = ({ messages }: MessageProps) => {
    // console.log("🚀 ~ MessageList ~ messages:", messages)
    const isShowLoading = messages.length > 0 && messages[messages.length - 1]?.role === "user"
    return (
        <>
            <Box flexDirection="column" marginBottom={1}>
                {messages.map((message, index) => {
                    const content = message.content.replace(/^\r?\n/, "");
                    const renderedContent = (markdownParser.parse(content) as string).trimEnd();
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
                                    <Text>
                                        {message.role === "user"
                                            ? symbols.prompt
                                            : symbols.circle}
                                    </Text>
                                </Box>
                                <Box flexShrink={1} flexGrow={1}>
                                    <Text>{renderedContent}</Text>
                                </Box>
                            </Box>
                        </Box>
                    );
                })}
            </Box>
            {isShowLoading && <LoadingMessage label='Working' />}
        </>

    )
}

export default memo(MessageList)
