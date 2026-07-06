import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useApp } from "ink";
import { brand } from "./styles.js";
import PromptInput from "./components/PromptInput.js";
import PlatformHeader from "./components/PlatformHeader.js";
import createClient from "./client/create.js";
import AnthropicClient from "./client/anthorpic.js";
import OpenAIClient from "./client/openai.js";


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
    const llmClient = useRef<AnthropicClient | OpenAIClient>(null);
    const { exit } = useApp();
    const [messages, setMessages] = useState<Message[]>([]);

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
            { role: "user", content: prompt }
        ]);

        try {
            const res = await llmClient.current?.sendMessage(prompt);

            setMessages(previous => [
                ...previous,
                { role: "assistant", content: res || "" }
            ]);
        } catch (error) {
            setMessages(previous => [
                ...previous,
                { role: "system", content: error instanceof Error ? error.message : String(error) }
            ]);
        }
    }, [exit]);

    const createLLMClient = useCallback(async () => {
        try {
            const client = createClient({ provider: "openai" });
            llmClient.current = client;
            // You can use the client here for further operations
        } catch (error) {
            console.error(error);
        }
    }, []);

    useEffect(() => {
        createLLMClient();
    }, []);

    return (
        <Box flexDirection="column">
            <PlatformHeader />
            <MessageList messages={messages} />
            <PromptInput onSubmit={handleSubmit} />
        </Box>
    );
}
