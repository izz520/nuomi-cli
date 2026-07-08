import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, useApp } from "ink";
import PromptInput from "./components/PromptInput.js";
import PlatformHeader from "./components/PlatformHeader.js";
import createClient from "./client/create.js";
import AnthropicClient from "./client/anthorpic.js";
import OpenAIClient from "./client/openai.js";
import { loadConfig } from "./config.js";
import MessageList, { Message } from "./components/MessageList.js";

//流式数据合并
const appendAssistantDelta = (
    previous: Message[],
    delta: {
        text: string;
        phase: Message["phase"];
        format: Message["format"];
    }
): Message[] => {
    const next = removeCurrentAssistantStatus(previous);
    const lastUserIndex = next.findLastIndex(message => message.role === "user");
    const messageIndex = next.findLastIndex((message, index) => {
        if (index < lastUserIndex || message.role !== "assistant") {
            return false;
        }

        return message.phase !== "working" && message.phase !== "thinking" && message.phase !== "tool_call";
    });

    if (messageIndex === -1) {
        const message: Message = {
            role: "assistant",
            content: delta.text,
            phase: delta.phase,
            format: delta.format
        };

        return [...next, message];
    }

    const message = next[messageIndex];

    next[messageIndex] = {
        ...message,
        phase: message.phase ?? delta.phase,
        format: message.format ?? delta.format,
        content: message.content + delta.text
    };

    return next;
};

const addWorkingStatus = (previous: Message[], prompt: string): Message[] => [
    ...previous,
    { role: "user", content: prompt },
    {
        role: "assistant",
        content: "",
        phase: "working",
        format: "plain"
    }
];

const markCurrentAssistantThinking = (previous: Message[]): Message[] => {
    const next = [...previous];
    const lastUserIndex = next.findLastIndex(message => message.role === "user");
    const statusIndex = next.findLastIndex((message, index) =>
        index > lastUserIndex &&
        message.role === "assistant" &&
        (message.phase === "working" || message.phase === "thinking")
    );

    if (statusIndex === -1) {
        return [
            ...next,
            {
                role: "assistant",
                content: "",
                phase: "thinking",
                format: "plain"
            }
        ];
    }

    next[statusIndex] = {
        ...next[statusIndex],
        phase: "thinking",
        format: "plain"
    };

    return next;
};

const removeCurrentAssistantStatus = (previous: Message[]): Message[] => {
    const lastUserIndex = previous.findLastIndex(message => message.role === "user");

    return previous.filter((message, index) => {
        if (index <= lastUserIndex || message.role !== "assistant") {
            return true;
        }

        return message.phase !== "working" && message.phase !== "thinking";
    });
};

export default function App() {
    const config = loadConfig();
    const llmClient = useRef<AnthropicClient | OpenAIClient>(null);
    const { exit } = useApp();
    const [messages, setMessages] = useState<Message[]>([]);

    const handleSystemTools = useCallback((prompt: string) => {
        if (prompt === "q" || prompt === "/exit") {
            exit();
            return true;
        }

        if (prompt === "/clear") {
            setMessages([]);
            return true;
        }

        if (prompt === "/help") {
            setMessages(previous => [
                ...previous,
                { role: "user", content: prompt },
                { role: "assistant", content: "Commands: /help, /clear, /exit, q" }
            ]);
            return true;
        }

        return false;
    }, [exit])

    const handleSubmit = useCallback(async (prompt: string) => {
        //处理一些系统操作
        if (handleSystemTools(prompt)) {
            return;
        }

        //开始处理消息
        if (!llmClient.current) {
            setMessages(previous => [
                ...previous,
                { role: "system", content: "LLM client is not initialized." }
            ]);
            return;
        }
        //默认先写入一条用户消息
        setMessages(previous => addWorkingStatus(previous, prompt));
        //开始写入Agent回复的消息
        try {
            for await (const event of llmClient.current.sendMessageStream(prompt)) {
                if (event.type === "thinking_delta") {
                    //开始输出思考的内容，或者是open的注释的内容
                    setMessages(previous => markCurrentAssistantThinking(previous));
                }
                if (event.type === "text_delta") {
                    setMessages(previous =>
                        appendAssistantDelta(previous, {
                            text: event.text,
                            phase: event.phase ?? "unknown",
                            format: event.phase === "final_answer" ? "markdown" : "plain"
                        })
                    );
                } else if (event.type === "tool_call_complete") {
                    setMessages(previous => [
                        ...removeCurrentAssistantStatus(previous),
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
    }, [handleSystemTools]);

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
