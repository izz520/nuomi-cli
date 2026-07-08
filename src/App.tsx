import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useApp } from "ink";
import { brand } from "./styles.js";
import PromptInput from "./components/PromptInput.js";
import PlatformHeader from "./components/PlatformHeader.js";
import createClient from "./client/create.js";
import AnthropicClient from "./client/anthorpic.js";
import OpenAIClient from "./client/openai.js";
import type { AssistantMessagePhase } from "./types/llm.js";
import { loadConfig } from "./config.js";
import MessageList, { Message } from "./components/MessageList.js";




export default function App() {
    const config = loadConfig();
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
        if (!llmClient.current) {
            setMessages(previous => [
                ...previous,
                { role: "system", content: "LLM client is not initialized." }
            ]);
            return;
        }
        try {
            for await (const event of llmClient.current.sendMessageStream(prompt)) {
                if (event.type === "text_delta") {

                    setMessages(previous => {
                        const next = [...previous];
                        const messageIndex = event.itemId ?
                            next.findIndex(message => message.itemId === event.itemId) :
                            -1;

                        if (messageIndex === -1) {
                            return [
                                ...next,
                                {
                                    role: "assistant",
                                    content: event.text,
                                    itemId: event.itemId,
                                    phase: event.phase ?? "unknown",
                                    format: event.phase === "final_answer" ? "markdown" : "plain"
                                }
                            ];
                        }

                        const message = next[messageIndex];

                        next[messageIndex] = {
                            ...message,
                            phase: message.phase ?? event.phase,
                            content: message.content + event.text
                        };

                        return next;
                    });
                } else if (event.type === "tool_call_complete") {
                    setMessages(previous => [
                        ...previous,
                        {
                            role: "assistant",
                            content: JSON.stringify(event.arguments),
                            phase: "tool_call",
                            format: "command"
                        }
                    ]);
                }
            }
        } catch (error) {
            setMessages(previous => [
                ...previous,
                { role: "system", content: error instanceof Error ? error.message : String(error) }
            ]);
        }
    }, [exit]);

    const createLLMClient = useCallback(async () => {
        try {
            const client = createClient({ provider: config.provider });
            // console.log("🚀 ~ App ~ client:", client)
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
            <Box padding={1} borderStyle="round" borderColor="#009697">
                <PlatformHeader />
            </Box>
            <MessageList messages={messages} />
            <PromptInput onSubmit={handleSubmit} />
        </Box>
    );
}
