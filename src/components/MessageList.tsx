import React, { memo } from 'react'
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
                    flexDirection="row"
                    alignItems="flex-start"
                    width="100%"
                    // marginBottom={message.role === "assistant" ? 1 : 0}
                    marginTop={1}
                    backgroundColor={message.role === "user" ? "gray" : undefined}
                >
                    {message.content ? (
                        <Box flexDirection="row" flexShrink={1} flexGrow={1}>
                            <Box width={2} flexShrink={0}>
                                <Text>{message.role === "user" ? symbols.prompt : symbols.circle}</Text>
                            </Box>
                            <Box flexShrink={1} flexGrow={1}>
                                <Text wrap="wrap">{message.content}</Text>
                            </Box>
                        </Box>
                    ) : null}
                </Box>
            ))}
        </Box>
    )
}

export default memo(MessageList)
