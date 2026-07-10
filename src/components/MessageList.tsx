import React, { memo, useEffect, useState } from 'react'
import { AssistantMessagePhase } from '../types/llm.js';
import { Box, Text } from 'ink';
import { symbols } from '../styles.js';
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
const LoadingMessage = ({ label }: { label: string }) => {
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
    return (
        <Box flexDirection="column" marginBottom={1}>
            {messages.map((message, index) => (
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
                            <Text wrap="wrap">{message.content}</Text>
                        </Box>
                    </Box>
                </Box>
            ))}
        </Box>
    )
}

export default memo(MessageList)
