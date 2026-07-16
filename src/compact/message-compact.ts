import AnthropicClient from "../client/anthorpic.js";
import OpenAIClient from "../client/openai.js";
import { MessageManager } from "../messageManager/message.js";
import { UsageAnchor } from "../types/compact.js";
import { IMessage } from "../types/messsage.js";
import { CompactBoundaryPayload } from "../types/session.js";
import { RecoveryManager } from "./recovery.js";
import buildSummaryPrompt from "./summary.js";

export class AutoCompactRetryCount {
    retryCount = 0;
}

export interface CompactResult {
    compacted: boolean;
    message: string;
    boundary?: CompactBoundaryPayload;
}
// 最大重试压缩次数
const MAX_RETRY_COUNT = 3;
// 字符转token比例
const CHARS_PER_TOKEN = 3.5
// 总结历史记录的估算token
const SUMMARY_OUTPUT_TOKEN = 20000
// 自动压缩的安全冗余
const AUTO_COMPACT_SAFE_TOKEN = 13000;
//手动压缩的安全冗余
const MANUAL_COMPACT_SAFE_TOKEN = 3000;
//最多原样保留多少token的近期消息
const KEEP_MAX_TOKENS = 40000;
//希望近期消息至少保留到约 10,000 token；
const KEEP_MIN_TOKENS = 10000;
//最少保留多少条近期消息
const MIN_KEEP_MESSAGES = 5;
const MIN_COMPACT_PREFIX = 2;
export async function compactContextMessage(
    //完整的历史记录
    messageManager: MessageManager,
    //使用的Agent
    client: OpenAIClient | AnthropicClient,
    //最大上下文
    contextWindow: number,
    //最大输出，上下文达到上限时包括了最新的回复的，所以要留一些空间给输出
    maxOutput: number,
    //自动压缩失败计数器？？果自动压缩连续失败 3 次，普通自动压缩会暂停，避免每轮都失败
    autoCompactRetryCount: AutoCompactRetryCount,
    //工具调用压缩、读取文件历史记录压缩、Skill压缩
    recoveryManager: RecoveryManager | null,
    //当前可用工具名列表
    toolSchemaNames: string[],
    //真实 token 使用锚点。模型上一轮结束时，API 会返回真实 token usage。Agent 会记下来，下一次估算上下文时不用从头估
    //简单理解：上次用了多少token
    usageAnchor: UsageAnchor | null = null,
    //当前 session 文件路径
    //压缩 summary 里会告诉模型：如果需要压缩前的具体细节，可以用 ReadFile 读完整 session 文件
    sessionFilePath: string = "",
    //压缩的消息
    compactToolResultMessage?: IMessage[]
): Promise<CompactResult> {
    //拿到当前消息列表下总消耗的token
    const tokens = currentContextTokens(messageManager, usageAnchor, compactToolResultMessage);
    //拿到自动压缩的阈值
    const autoThreshold = calcCompactThreshold(contextWindow, maxOutput);
    //拿到强制压缩的阈值或者手动压缩
    const hardBlock = calcCompactThreshold(contextWindow, maxOutput, true);

    //现在的token量小于自动压缩的值
    if (tokens < autoThreshold) {
        //不需要压缩
        return { compacted: false, message: "" };
    }

    // Past the hard-block line we must compact even if the circuit breaker tripped.
    //当前的token量已经大于了必须压缩的阈值，强制进行压缩
    const forced = tokens >= hardBlock;
    if (!forced && autoCompactRetryCount.retryCount >= MAX_RETRY_COUNT) {
        //如果还没到硬极限，并且之前已经连续压缩失败 3 次，就先不压缩了。
        return {
            compacted: false,
            message: `Auto-compact circuit breaker: ${MAX_RETRY_COUNT} consecutive failures`,
        };
    }

    try {
        //真正的压缩
        const result = await compactMessage(messageManager, client, recoveryManager, toolSchemaNames, sessionFilePath, compactToolResultMessage);
        autoCompactRetryCount.retryCount = 0;
        return result;
    } catch (err) {
        autoCompactRetryCount.retryCount++;
        return {
            compacted: false,
            message: `Auto-compact failed: ${(err as Error).message}`,
        };
    }
}

// 计算当前消息列表下总消耗的token
export function currentContextTokens(
    //消息记录
    messageManager: MessageManager,
    //上次使用token量
    usageAnchor: UsageAnchor | null,
    //仅仅压缩工具结果后的消息记录
    compactToolResultMessage?: IMessage[]
): number {
    //如果有仅仅压缩工具结果后的消息记录
    if (compactToolResultMessage && compactToolResultMessage.length > 0) {
        //第一次，没有token用量
        if (!usageAnchor) {
            //直接返回计算出来的所有消息的token占用
            return estimateMessagesToken(compactToolResultMessage);
        }
        //之前有记录
        //找到最小的token
        const start = Math.min(usageAnchor.anchorCount, compactToolResultMessage.length);
        return usageAnchor.baselineTokens + estimateMessagesToken(compactToolResultMessage.slice(start));
    }
    //如果没有压缩过的历史消息，且没有压缩的历史消息
    if (!usageAnchor) {
        //则直接返回计算原始历史消息
        return estimateTokens(messageManager);
    }
    //有原始消息，并且之前有token用量
    const messages = messageManager.getMessages();
    // Clamp in case the transcript was truncated (e.g. by a compaction) below the
    // anchor index — then nothing new to add on top of the baseline.
    const start = Math.min(usageAnchor.anchorCount, messages.length);
    return usageAnchor.baselineTokens + estimateMessagesToken(messages.slice(start));
}

// 估算当前消息的总token占用
export function estimateMessagesToken(messages: IMessage[]): number {
    // 设置从字符长度
    let totalChars = 0;
    // 循环消息体
    for (const msg of messages) {
        //总字符长度里面先保存当前消息内容的总长度
        totalChars += msg.content.length;
        if (msg.toolUses) {
            //是工具调用请求的消息，把工具调用请求的内容计算进去
            totalChars += JSON.stringify(msg.toolUses).length;
        }
        if (msg.toolResults) {
            //是工具调用结果的消息
            for (const tr of msg.toolResults) {
                //循环把工具调用结果计算进去
                totalChars += tr.content.length;
            }
        }
        if (msg.thinkingBlocks) {
            //如果是思考的消息
            for (const tb of msg.thinkingBlocks) {
                //则也记录全部思考的长度
                totalChars += tb.thinking.length;
            }
        }
    }
    //最后拿到了所有消息的所有字符，然后除于3.5，得到当前所有消息列表的总token占用
    return Math.ceil(totalChars / CHARS_PER_TOKEN);
}

export function estimateTokens(messageManager: MessageManager): number {
    return estimateMessagesToken(messageManager.getMessages());
}

//计算压缩阈值
export function calcCompactThreshold(contextWindow: number, maxOutput: number, manual = false) {
    //减去预留的输出token后，当前还有多少可用的token
    const effective = contextWindow - Math.min(maxOutput, SUMMARY_OUTPUT_TOKEN);
    //拿到启动压缩的安全冗余值
    const margin = manual ? MANUAL_COMPACT_SAFE_TOKEN : AUTO_COMPACT_SAFE_TOKEN;
    // 计算出触发的阈值
    return effective - margin;
}

//真正的压缩
async function compactMessage(
    //原始消息记录
    messageManager: MessageManager,
    //Agent
    client: OpenAIClient | AnthropicClient,
    //读过哪些文件、启用了哪些 skill
    recoveryManager: RecoveryManager | null,
    //所有工具的名称
    toolSchemaNames: string[],
    //压缩前的原始消息
    sessionFilePath: string = "",
    //只压缩工具结果后的消息
    compactToolResultMessage?: IMessage[]
): Promise<CompactResult> {
    //如果有压缩工具结果后的消息，就用压缩后的，没有就用原始的
    const estimationMessages = (compactToolResultMessage && compactToolResultMessage.length > 0) ? compactToolResultMessage : messageManager.getMessages();
    //计算保留原始消息的消息列表开始的index
    const keepStart = computeKeepStartIndex(estimationMessages);
    //index小于0，或者小于最小保留条数
    if (keepStart <= 0 || keepStart < MIN_COMPACT_PREFIX) {
        //直接返回，因为只有2条，没必要压缩
        return {
            compacted: false,
            message: `Compaction skipped: only ${keepStart} message(s) to summarize, kept verbatim`,
        };
    }
    // 拿到需要拿去总结的消息列表
    const toSummarize = estimationMessages.slice(0, keepStart);
    // 拿到需要原样保留的消息列表
    const toKeep = estimationMessages.slice(keepStart);
    //把需要总结的内容变成markdown
    const conversationText = toSummarize
        .map((m) => {
            let text = `[${m.role}]: ${m.content}`;
            if (m.toolUses) {
                text += `\n[tools: ${m.toolUses.map((t) => t.toolName).join(", ")}]`;
            }
            return text;
        })
        .join("\n\n");
    //创建一个新的消息管理器
    const summaryMessageManager = new MessageManager();
    //把总结的内容作为用户的话，放进summaryMessageManager消息管理器
    summaryMessageManager.addUserMessage(buildSummaryPrompt(conversationText));
    //拿到流式出处的总结的内容
    let summaryText = "";
    //调用Agent，发送总结的文本，让AI给一个总结文案
    const stream = client.sendMessageStream(summaryMessageManager, []);
    for await (const event of stream) {
        if (event.type === "text_delta") {
            summaryText += event.text;
        }
    }
    //匹配<summary>包裹的内容
    const summaryMatch = summaryText.match(/<summary>([\s\S]*?)<\/summary>/);
    //有summary包括的，则取里面的内容,没有则返回让总结的文案
    const summary = summaryMatch ? summaryMatch[1].trim() : summaryText;
    //拿到近期工具调用结构以及Skill的markdown
    const recoveryPrompt = recoveryManager
        ? recoveryManager.buildRecoveryPrompt(toolSchemaNames)
        : "";
    //拼接markdown提示词
    let summaryContent = "本次会话延续自之前的对话，因上下文空间不足进行了压缩。以下是早期对话的摘要：\n\n" + summary;
    if (toKeep.length > 0) {
        // 有保留原文的消息，就加这个文案
        summaryContent += "\n\n近期消息已原样保留。";
    }
    if (sessionFilePath) {
        // 如果之前有存储的话，AI需要查细节，可以去读取这个路径
        summaryContent += `\n\n如果你需要压缩前的具体细节（代码片段、报错信息等），请用 ReadFile 读取完整会话记录：${sessionFilePath}`;
    }
    if (recoveryPrompt) {
        //如果近期有工具调用和Skill，则也加入进去
        summaryContent += `\n\n---\n\n${recoveryPrompt}`;
    }
    // 把消息管理器中的所有消息历史记录改成本次压缩后的
    messageManager.replaceWithCompacted(summaryContent, toKeep);

    const keep = toKeep
        .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
        .map((m) => ({ role: m.role, content: m.content }));
    // 返回压缩后的结果
    return {
        compacted: true,
        message: `Compacted ${toSummarize.length} messages into summary (${summary.length} chars), kept ${toKeep.length} recent messages verbatim`,
        boundary: { summary, keep },
    };
}

export function computeKeepStartIndex(messages: IMessage[]): number {
    let keepTokens = 0;
    let keepCount = 0;
    let keepStart = messages.length;
    //反方向拿，优先保留最新的会话
    for (let i = messages.length - 1; i >= 0; i--) {
        //计算当前消息的token量
        const t = estimateMessagesToken([messages[i]]);
        //保持的会话数大于0.并且最新的token超多了40000了，丢掉本次记录，不要了
        if (keepCount > 0 && keepTokens + t > KEEP_MAX_TOKENS) {
            break;
        }
        keepStart = i;
        keepTokens += t;
        keepCount++;
        //如果压缩后的token大于10000token了，或者保留的总条数大于5了，也不存了，丢掉
        if (keepTokens >= KEEP_MIN_TOKENS || keepCount >= MIN_KEEP_MESSAGES) {
            break;
        }
    }

    // Don't split a tool_use↔tool_result pair: if the boundary lands on a
    // tool_result user message, move it back past the matching tool_use assistant
    // message so the pair stays whole (better to keep one extra pair than to
    // leave an orphaned tool_result with no originating tool_use).
    keepStart = backUpPastToolUse(messages, keepStart);
    return keepStart;
}

// 计算当前预估保留消息的开始的消息是否是工具调用的结果，如果是结果，则开始要是工具调用请求的消息
function backUpPastToolUse(messages: IMessage[], keepStartIndex: number): number {
    //消息下标小于0 ，或者消息下标大于原始消息条数，直接返回之前估算出来的消息下标
    if (keepStartIndex <= 0 || keepStartIndex >= messages.length) return keepStartIndex;
    //如果说计算出来保留原始消息开始的index是不是工具调用的消息，直接返回估算出来的下标
    if (!hasToolResultMessage(messages[keepStartIndex])) return keepStartIndex;
    //保留原始消息开始的下标是工具调用
    //拿到调用工具的所有toolId
    const ids = new Set(
        (messages[keepStartIndex].toolResults ?? []).map((tr) => tr.toolUseId)
    );
    //从估算出来的保留消息开始的下标，再往前找
    // 比如一共5条消息，估算出来是保留第3条开始的消息，但是第三条消息是工具调用，则把下标往前移，编程第二条开始，然后再判断
    for (let i = keepStartIndex - 1; i >= 0; i--) {
        //拿到上一条消息内容
        const m = messages[i];
        //如果上一条消息是Agent，并且有请求工具，调用工具调用结果消息里面有这个消息的工具id
        if (
            m.role === "assistant" &&
            m.toolUses &&
            m.toolUses.some((tu) => ids.has(tu.toolUseId))
        ) {
            //直接工具请求的消息的下标作为保留消息的开始
            return i;
        }
    }
    //不然的话，还是返回预估出来的
    return keepStartIndex;
}

// 判断消息是否是工具调用结果的消息
function hasToolResultMessage(msg: IMessage): boolean {
    // 判断消息是否是工具调用结果的消息
    return msg.role === "user" && !!msg.toolResults && msg.toolResults.length > 0;
}

function formatMessageForSummary(message: IMessage): string {
    const sections: string[] = [];

    if (message.content) {
        sections.push(`[${message.role}]\n${message.content}`);
    } else {
        sections.push(`[${message.role}]`);
    }

    if (message.toolUses?.length) {
        for (const toolUse of message.toolUses) {
            sections.push(
                `[tool_use id=${toolUse.toolUseId} name=${toolUse.toolName}]\n` +
                JSON.stringify(toolUse.arguments, null, 2)
            );
        }
    }

    if (message.toolResults?.length) {
        for (const toolResult of message.toolResults) {
            sections.push(
                `[tool_result id=${toolResult.toolUseId} error=${toolResult.isError}]\n` +
                toolResult.content
            );
        }
    }

    return sections.join("\n");
}