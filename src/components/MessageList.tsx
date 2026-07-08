import React, { memo, useCallback, useMemo } from 'react'
import { AssistantMessagePhase } from '../types/llm.js';
import { Box, Text } from 'ink';
import { symbols } from '../styles.js';
type MessageFormat = "plain" | "markdown" | "command";
type MessagePhase = AssistantMessagePhase | "tool_call";
export interface Message {
    role: "user" | "assistant" | "system";
    content: string;
    itemId?: string;
    phase?: MessagePhase;
    format?: MessageFormat;
};
interface MessageProps {
    messages: Message[];
}

const MessageList = ({ messages }: MessageProps) => {
    // console.log("🚀 ~ MessageList ~ messages:", messages)
    return (
        <Box flexDirection="column" marginBottom={1}>
            {messages.map((message, index) => (
                <Box
                    key={index}
                    flexDirection="column"
                    // marginBottom={message.role === "assistant" ? 1 : 0}
                    marginTop={1}
                    backgroundColor={message.role === "user" ? "gray" : undefined}
                >
                    {message.content ? (
                        <Box>
                            {message.role === "user" && <Text>{symbols.prompt}{" "}</Text>}
                            {message.role === "assistant" && <Text>{symbols.circle}{" "}</Text>}
                            <Text>{message.content}</Text>
                        </Box>
                    ) : null}
                </Box>
            ))}
        </Box>
    )
}

export default memo(MessageList)
