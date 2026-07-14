import React, { memo } from 'react'
import { AssistantMessagePhase } from '../../types/llm.js';
import { Box, Text } from 'ink';
import { Marked, type MarkedExtension } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { symbols } from '../../styles.js';
import LoadingMessage from './LoaidngMessage.js';

const markdownParser = new Marked(
    markedTerminal({
        reflowText: true,
        paragraph: (text: string) => text
    }) as unknown as MarkedExtension
);

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
}

const formatElapsed = (elapsed?: number): string => {
    if (elapsed === undefined || elapsed <= 0) return "";
    if (elapsed < 1) return `${Math.max(1, Math.round(elapsed * 1000))}ms`;
    return `${elapsed.toFixed(1)}s`;
};

const truncateLine = (value: string, max = 140): string => {
    const firstLine = value.split(/\r?\n/, 1)[0].trim();
    return firstLine.length > max ? firstLine.slice(0, max) + "…" : firstLine;
};

const describeGroupSuccess = (group: ToolGroupState): string => {
    if (group.title !== "Search project metadata") return group.resultLabel;

    const matchedTool = group.tools.find((tool) =>
        tool.status === "success"
        && tool.output
        && !/^No (matches|files)/i.test(tool.output)
    );
    const firstLine = matchedTool?.output?.split(/\r?\n/, 1)[0].trim() ?? "";
    const matchedFile = firstLine.match(/^([^:\t]+?)(?::\d+:|$)/)?.[1];

    if (!matchedFile) return "Project metadata search complete";
    const subject = group.tools.some((tool) => /version/i.test(tool.label))
        ? "version"
        : "project metadata";
    return `Found ${subject} in ${matchedFile}`;
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
    const resultLabel = failedTools.length === 0
        ? describeGroupSuccess(group)
        : `${failedTools.length} of ${group.tools.length} tools failed`;
    const errorDetail = failedTools.length > 0
        ? truncateLine(failedTools[0].output ?? "")
        : "";

    return (
        <Box flexDirection="column">
            <Box>
                <Box width={2} flexShrink={0}>
                    <Text color="cyan">{symbols.tool}</Text>
                </Box>
                <Text>{group.title}</Text>
            </Box>
            {group.tools.map((tool, index) => {
                const isLast = index === group.tools.length - 1;
                const failed = tool.status === "error" || tool.status === "denied";
                return (
                    <Box key={tool.toolId} paddingLeft={2}>
                        <Text dimColor={!failed} color={failed ? "red" : undefined}>
                            {`${isLast ? "└" : "├"} ${tool.label}${failed ? " (failed)" : ""}`}
                        </Text>
                    </Box>
                );
            })}
            {!running && (
                <Box marginTop={1}>
                    <Box width={2} flexShrink={0}>
                        <Text color={resultColor}>{resultIcon}</Text>
                    </Box>
                    <Text>{resultLabel}</Text>
                    {elapsed && <Text dimColor>{` · ${elapsed}`}</Text>}
                </Box>
            )}
            {!running && errorDetail && (
                <Box paddingLeft={2}>
                    <Text dimColor>{errorDetail}</Text>
                </Box>
            )}
        </Box>
    );
};


const MessageList = ({ messages, isWorking }: MessageProps) => {
    // console.log("🚀 ~ MessageList ~ messages:", messages)
    return (
        <>
            <Box flexDirection="column" marginBottom={1}>
                {messages.map((message, index) => {
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
                            {message.phase === "tool_call" ? (
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
            {isWorking && <LoadingMessage />}
        </>

    )
}

export default memo(MessageList)
