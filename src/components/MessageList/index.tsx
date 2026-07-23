import React, { memo } from 'react'
import { AssistantMessagePhase } from '../../types/llm.js';
import { Box, Text } from 'ink';
import { Marked, type MarkedExtension } from 'marked';
import { markedTerminal } from 'marked-terminal';
import chalk from 'chalk';
import { symbols } from '../../styles.js';
import LoadingMessage from './LoadingMessage.js';

//创建一个markdown的终端插件
const terminalExtension = markedTerminal({
    reflowText: true,
    tab: 0,
    paragraph: (text: string) => text,
    codespan: chalk.cyan,
}) as unknown as MarkedExtension;

const renderTerminalCode = terminalExtension.renderer?.code;

if (renderTerminalCode && terminalExtension.renderer) {
    terminalExtension.renderer.code = function (token) {
        const rendered = renderTerminalCode.call(this, token);
        if (rendered === false || rendered === undefined) return rendered;

        const highlighted = rendered.replace(/\n+$/, "");
        // 只通过留白和 ANSI 语法高亮区分代码块，不插入可见装饰字符。
        // 终端复制时会忽略 ANSI 样式，因此得到的仍是原始代码。
        return `\n${highlighted}\n\n`;
    };
}

const markdownParser = new Marked(terminalExtension);

type MessageFormat = "plain" | "markdown" | "command";
export type MessagePhase = AssistantMessagePhase | "working" | "thinking" | "tool_call" | "error";
export type ToolMessageStatus = "running" | "success" | "error" | "denied";

export interface ToolGroupItemState {
    toolId: string;
    toolName: string;
    label: string;
    status: ToolMessageStatus;
    output?: string;
    elapsed?: number;
}

export interface ToolGroupState {
    groupId: string;
    title: string;
    resultLabel: string;
    concurrent: boolean;
    tools: ToolGroupItemState[];
}

export interface ChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
    phase?: MessagePhase;
    format?: MessageFormat;
    toolGroup?: ToolGroupState;
};
interface MessageProps {
    messages: ChatMessage[];
    isWorking: boolean;
    workingLabel?: string;
}

const formatElapsed = (elapsed?: number): string => {
    if (elapsed === undefined || elapsed <= 0) return "";
    if (elapsed < 1) return `${Math.max(1, Math.round(elapsed * 1000))}ms`;
    return `${elapsed.toFixed(1)}s`;
};

const truncate = (value: string, max: number): string => {
    return value.length > max ? value.slice(0, max) + "…" : value;
};

const DIAGNOSTIC_LINE = /\b(?:error|exception|failed|failure|denied|not found|no such file|timed out|timeout|cannot|can't|could not|refused|unavailable|invalid|missing|required)\b/i;

export const summarizeToolError = (value: string, max = 140): string => {
    const lines = value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        // BashTool echoes the submitted command as context. It is useful in
        // full output but is never the reason the command failed.
        .filter((line) => !line.startsWith("$ "));

    const exitCode = [...lines].reverse().find((line) => /^Exit code \d+/i.test(line));
    const candidates = lines.filter((line) =>
        !/^Exit code \d+/i.test(line)
        && line !== "Traceback (most recent call last):"
    );
    const diagnostic = [...candidates].reverse().find((line) => DIAGNOSTIC_LINE.test(line));
    const fallback = candidates.at(-1) ?? exitCode ?? "Tool call failed";

    return truncate(diagnostic ?? fallback, max);
};

const ToolGroupMessage = ({ message }: { message: ChatMessage }) => {
    const group = message.toolGroup;
    if (!group) return <Text>{message.content}</Text>;

    const running = group.tools.some((tool) => tool.status === "running");
    const failedTools = group.tools.filter((tool) => tool.status === "error" || tool.status === "denied");
    const denied = failedTools.some((tool) => tool.status === "denied");
    const elapsedSeconds = group.concurrent
        ? Math.max(...group.tools.map((tool) => tool.elapsed ?? 0))
        : group.tools.reduce((total, tool) => total + (tool.elapsed ?? 0), 0);
    const elapsed = formatElapsed(elapsedSeconds);
    const resultIcon = failedTools.length === 0
        ? symbols.success
        : denied
            ? symbols.denied
            : symbols.error;
    const resultColor = failedTools.length === 0 ? "green" : denied ? "yellow" : "red";
    const errorDetail = failedTools.length > 0
        ? summarizeToolError(failedTools[0].output ?? "")
        : "";

    return (
        <Box flexDirection="column">
            <Box>
                <Box width={2} flexShrink={0}>
                    <Text color={resultColor}>{resultIcon}</Text>
                </Box>
                <Text dimColor={failedTools.length === 0}>{group.title}</Text>
                {elapsed && <Text dimColor>{` · ${elapsed}`}</Text>}
            </Box>
            {!running && errorDetail && (
                <Box paddingLeft={2}>
                    <Text color={denied ? "yellow" : "red"} dimColor>{errorDetail}</Text>
                </Box>
            )}
        </Box>
    );
};

const SystemMessage = ({ content }: { content: string }) => (
    <Box flexDirection="row" flexShrink={1} flexGrow={1} width="100%">
        <Box width={9} flexShrink={0}>
            <Text color="cyan">{symbols.system} </Text>
            <Text color="cyan" bold>System</Text>
        </Box>
        <Box flexShrink={1} flexGrow={1}>
            <Text>{content}</Text>
        </Box>
    </Box>
);


const MessageList = ({ messages, isWorking, workingLabel }: MessageProps) => {
    // console.log("🚀 ~ MessageList ~ messages:", messages)
    return (
        <>
            <Box flexDirection="column" marginBottom={1}>
                {messages.map((message, index) => {
                    // The shared loading row represents the active step. Once a
                    // step finishes, render its compact result in the trace.
                    if (
                        message.phase === "tool_call"
                        && message.toolGroup?.tools.some((tool) => tool.status === "running")
                    ) {
                        return null;
                    }

                    const content = message.content.replace(/^\r?\n/, "");
                    const renderedContent = message.phase === "tool_call"
                        ? content
                        : (markdownParser.parse(content) as string).trimEnd();
                    //展示消息签名的图标
                    const getIconType = () => {
                        if (message.role === "user") {
                            return symbols.prompt
                        } else {
                            if (message.phase === "thinking") return symbols.thinking
                            if (message.phase === "error") return symbols.error
                            return symbols.circle
                        }
                    }
                    return (
                        <Box
                            key={message.toolGroup?.groupId ?? index}
                            flexDirection="column"
                            alignItems="flex-start"
                            width="100%"
                            // marginBottom={message.role === "assistant" ? 1 : 0}
                            marginTop={1}
                            backgroundColor={message.role === "user" ? "gray" : undefined}
                        >
                            {message.role === "system" ? (
                                <SystemMessage content={renderedContent} />
                            ) : message.phase === "tool_call" ? (
                                <ToolGroupMessage message={message} />
                            ) : (
                                <Box flexDirection="row" flexShrink={1} flexGrow={1}>
                                    <Box width={2} flexShrink={0}>
                                        <Text color={message.phase === "error" ? 'red' : undefined} dimColor={message.phase === "thinking"}>
                                            {getIconType()}
                                        </Text>
                                    </Box>
                                    <Box flexShrink={1} flexGrow={1}>
                                        {message.phase === "error" && <Text color="red">{renderedContent}</Text>}
                                        {message.phase !== "error" && <Text dimColor={message.phase === "thinking"}>{renderedContent}</Text>}
                                    </Box>
                                </Box>
                            )}
                        </Box>
                    );
                })}
            </Box>
            {isWorking && <LoadingMessage label={workingLabel} />}
        </>

    )
}

export default memo(MessageList)
