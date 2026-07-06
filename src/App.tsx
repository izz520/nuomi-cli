import React, { memo, useCallback, useState } from "react";
import { Box, Text, useApp } from "ink";
import { brand } from "./styles.js";
import PromptInput from "./components/PromptInput.js";
import PlatformHeader from "./components/PlatformHeader.js";


type Message = {
    role: "user" | "assistant" | "system";
    content: string;
};



const MessageList = memo(function MessageList({
    messages
}: {
    messages: Message[];
}) {
    return (
        <Box flexDirection="column" marginBottom={1}>
            {messages.map((message, index) => (
                <Box key={index}>
                    <Text color={message.role === "user" ? "cyan" : "green"}>
                        {message.role === "user" ? "You" : message.role === "assistant" ? "Nuomi" : "System"}:
                    </Text>
                    <Text> {message.content}</Text>
                </Box>
            ))}
        </Box>
    );
});


export default function App() {
    const { exit } = useApp();
    const [messages, setMessages] = useState<Message[]>([

    ]);

    const handleSubmit = useCallback(async (prompt: string) => {
        if (prompt === "q" || prompt === "/exit") {
            exit();
            return;
        }

        if (prompt === "/clear") {
            setMessages([]);
            return;
        }

        if (prompt === "/help") {
            setMessages(previous => [
                ...previous,
                { role: "user", content: prompt },
                { role: "assistant", content: "Commands: /help, /clear, /exit, q" }
            ]);
            return;
        }

        setMessages(previous => [
            ...previous,
            { role: "user", content: prompt },
            { role: "assistant", content: `You said: ${prompt}` }
        ]);
    }, [exit]);

    return (
        <Box flexDirection="column">
            <PlatformHeader />
            <MessageList messages={messages} />
            <PromptInput onSubmit={handleSubmit} />
        </Box>
    );
}
