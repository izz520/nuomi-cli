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


type MessageFormat = "plain" | "markdown" | "command";
type MessagePhase = AssistantMessagePhase | "tool_call";

type Message = {
    role: "user" | "assistant" | "system";
    content: string;
    itemId?: string;
    phase?: MessagePhase;
    format?: MessageFormat;
};

type CommandPayload = {
    cmd: string;
    workdir?: string;
};

type MarkdownBlock =
    | { type: "text"; text: string }
    | { type: "code"; text: string; language?: string };

function parseCommandPayload(content: string): CommandPayload | null {
    try {
        const parsed = JSON.parse(content.trim()) as Record<string, unknown>;

        if (typeof parsed.cmd !== "string") {
            return null;
        }

        return {
            cmd: parsed.cmd,
            workdir: typeof parsed.workdir === "string" ? parsed.workdir : undefined
        };
    } catch {
        return null;
    }
}

function getMessageFormat(message: Message): MessageFormat {
    if (message.format) {
        return message.format;
    }

    if (message.role === "assistant" && parseCommandPayload(message.content)) {
        return "command";
    }

    if (message.phase === "final_answer") {
        return "markdown";
    }

    return "plain";
}

function getMessageLabel(message: Message): string {
    if (message.role === "user") {
        return "You";
    }

    if (message.role === "system") {
        return "System";
    }

    if (getMessageFormat(message) === "command" || message.phase === "tool_call") {
        return "Command";
    }

    if (message.phase === "commentary") {
        return "Nuomi · note";
    }

    return "Nuomi";
}

function getLabelColor(message: Message): string {
    if (message.role === "user") {
        return "cyan";
    }

    if (message.role === "system") {
        return "red";
    }

    if (getMessageFormat(message) === "command" || message.phase === "tool_call") {
        return "yellow";
    }

    if (message.phase === "commentary") {
        return "gray";
    }

    return "green";
}

function splitMarkdownBlocks(content: string): MarkdownBlock[] {
    const blocks: MarkdownBlock[] = [];
    const lines = content.split("\n");
    let textBuffer: string[] = [];
    let codeBuffer: string[] = [];
    let codeLanguage: string | undefined;

    const flushText = () => {
        if (textBuffer.length > 0) {
            blocks.push({ type: "text", text: textBuffer.join("\n") });
            textBuffer = [];
        }
    };

    const flushCode = () => {
        blocks.push({
            type: "code",
            text: codeBuffer.join("\n"),
            language: codeLanguage
        });
        codeBuffer = [];
        codeLanguage = undefined;
    };

    for (const line of lines) {
        const fenceMatch = line.match(/^```(\S*)\s*$/);

        if (fenceMatch && codeLanguage === undefined) {
            flushText();
            codeLanguage = fenceMatch[1] || "";
            continue;
        }

        if (fenceMatch && codeLanguage !== undefined) {
            flushCode();
            continue;
        }

        if (codeLanguage !== undefined) {
            codeBuffer.push(line);
        } else {
            textBuffer.push(line);
        }
    }

    if (codeLanguage !== undefined) {
        flushCode();
    }

    flushText();

    return blocks;
}

function MessageContent({ message }: { message: Message }) {
    const format = getMessageFormat(message);

    if (format === "command") {
        const command = parseCommandPayload(message.content);

        if (command) {
            return (
                <Box flexDirection="column">
                    <Text color="yellow">$ {command.cmd}</Text>
                    {command.workdir ? <Text dimColor>cwd: {command.workdir}</Text> : null}
                </Box>
            );
        }
    }

    if (format === "markdown") {
        return (
            <Box flexDirection="column">
                {splitMarkdownBlocks(message.content).map((block, index) => {
                    if (block.type === "code") {
                        return (
                            <Box key={index} flexDirection="column" marginY={1}>
                                <Text dimColor>```{block.language || ""}</Text>
                                <Text color="cyanBright">{block.text}</Text>
                                <Text dimColor>```</Text>
                            </Box>
                        );
                    }

                    return <Text key={index}>{block.text}</Text>;
                })}
            </Box>
        );
    }

    return <Text dimColor={message.phase === "commentary"}>{message.content}</Text>;
}



const MessageList = memo(function MessageList({
    messages
}: {
    messages: Message[];
}) {
    return (
        <Box flexDirection="column" marginBottom={1}>
            {messages.map((message, index) => (
                <Box key={index} flexDirection="column" marginBottom={message.role === "assistant" ? 1 : 0}>
                    <Text color={getLabelColor(message)}>
                        {getMessageLabel(message)}:
                    </Text>
                    {message.content ? (
                        <Box marginLeft={2} flexDirection="column">
                            <MessageContent message={message} />
                        </Box>
                    ) : null}
                </Box>
            ))}
        </Box>
    );
});


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
            <PlatformHeader />
            <MessageList messages={messages} />
            <PromptInput onSubmit={handleSubmit} />
        </Box>
    );
}
