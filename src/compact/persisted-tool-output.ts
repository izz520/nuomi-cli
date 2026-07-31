import { createHash } from "node:crypto";
import {
    mkdirSync,
    readdirSync,
    readFileSync,
    statSync,
    unlinkSync,
    utimesSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const TOOL_OUTPUT_PREVIEW_CHARS = 2000;
export const TOOL_OUTPUT_CHUNK_CHARS = 8000;
export const TOOL_OUTPUT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const TOOL_OUTPUT_CACHE_MAX_BYTES = 100 * 1024 * 1024;
export const TOOL_OUTPUT_CACHE_MIN_AGE_MS = 5 * 60 * 1000;

interface ToolOutputCacheEntry {
    path: string;
    size: number;
    mtimeMs: number;
}

export interface ToolOutputCleanupOptions {
    maxBytes?: number;
    ttlMs?: number;
    minAgeMs?: number;
    nowMs?: number;
    protectedPaths?: ReadonlySet<string>;
}

export interface ToolOutputCleanupResult {
    removedFiles: number;
    removedBytes: number;
    remainingBytes: number;
}

function toolResultsDir(workDir: string): string {
    return join(workDir, ".nuomi", "tool_results");
}

function toolResultFileName(toolUseId: string): string {
    const digest = createHash("sha256").update(toolUseId).digest("hex");
    return `${digest}.txt`;
}

export function getPersistedToolResultPath(workDir: string, toolUseId: string): string {
    return join(toolResultsDir(workDir), toolResultFileName(toolUseId));
}

export function cleanupPersistedToolResults(
    workDir: string,
    options: ToolOutputCleanupOptions = {},
): ToolOutputCleanupResult {
    const dir = toolResultsDir(workDir);
    const maxBytes = Math.max(0, options.maxBytes ?? TOOL_OUTPUT_CACHE_MAX_BYTES);
    const ttlMs = Math.max(0, options.ttlMs ?? TOOL_OUTPUT_CACHE_TTL_MS);
    const minAgeMs = Math.max(0, options.minAgeMs ?? TOOL_OUTPUT_CACHE_MIN_AGE_MS);
    const nowMs = options.nowMs ?? Date.now();
    const protectedPaths = options.protectedPaths ?? new Set<string>();
    let entries: ToolOutputCacheEntry[];

    try {
        entries = readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.txt$/.test(entry.name))
            .flatMap((entry) => {
                const path = join(dir, entry.name);
                try {
                    const stat = statSync(path);
                    return [{ path, size: stat.size, mtimeMs: stat.mtimeMs }];
                } catch {
                    return [];
                }
            });
    } catch {
        return { removedFiles: 0, removedBytes: 0, remainingBytes: 0 };
    }

    let remainingBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    let removedFiles = 0;
    let removedBytes = 0;

    const removeEntry = (entry: ToolOutputCacheEntry): boolean => {
        if (protectedPaths.has(entry.path)) return false;
        try {
            unlinkSync(entry.path);
            remainingBytes -= entry.size;
            removedFiles++;
            removedBytes += entry.size;
            return true;
        } catch {
            return false;
        }
    };

    const retained: ToolOutputCacheEntry[] = [];
    for (const entry of entries) {
        if (ttlMs === 0 || nowMs - entry.mtimeMs > ttlMs) {
            if (removeEntry(entry)) continue;
        }
        retained.push(entry);
    }

    retained.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const entry of retained) {
        if (remainingBytes <= maxBytes) break;
        // A concurrent agent may have just created or read this result.
        // Prefer a temporary cache-size overshoot over breaking a live reference.
        if (nowMs - entry.mtimeMs < minAgeMs) continue;
        removeEntry(entry);
    }

    return { removedFiles, removedBytes, remainingBytes };
}

export function saveToolResultToFile(
    workDir: string,
    toolUseId: string,
    content: string,
): string {
    const path = getPersistedToolResultPath(workDir, toolUseId);
    mkdirSync(toolResultsDir(workDir), { recursive: true });
    // A repeated tool id must never leave stale content behind.
    writeFileSync(path, content, { encoding: "utf-8", flag: "w" });
    // Cleanup is best-effort; a cleanup failure must not discard this result.
    cleanupPersistedToolResults(workDir, {
        protectedPaths: new Set([path]),
    });
    return path;
}

function safePreviewHead(content: string, limit: number): string {
    let head = content.slice(0, limit);
    const lastCodeUnit = head.charCodeAt(head.length - 1);
    if (lastCodeUnit >= 0xD800 && lastCodeUnit <= 0xDBFF) {
        head = head.slice(0, -1);
    }
    return head;
}

function safePreviewTail(content: string, limit: number): string {
    let start = Math.max(0, content.length - limit);
    const firstCodeUnit = content.charCodeAt(start);
    if (firstCodeUnit >= 0xDC00 && firstCodeUnit <= 0xDFFF && start > 0) {
        start--;
    }
    return content.slice(start);
}

function formatToolOutputPreview(content: string): string {
    if (content.length <= TOOL_OUTPUT_PREVIEW_CHARS) {
        return `完整预览（${content.length} 个字符）：\n${content}`;
    }

    const half = Math.floor(TOOL_OUTPUT_PREVIEW_CHARS / 2);
    const head = safePreviewHead(content, half);
    const tail = safePreviewTail(content, TOOL_OUTPUT_PREVIEW_CHARS - half);
    const omittedChars = Math.max(0, content.length - head.length - tail.length);
    return `开头（前 ${head.length} 个字符）：
${head}

… 中间省略 ${omittedChars} 个字符 …

结尾（后 ${tail.length} 个字符）：
${tail}`;
}

export function formatPersistedToolResult(
    content: string,
    path: string,
    toolUseId: string,
): string {
    const sizeKB = Math.max(1, Math.ceil(Buffer.byteLength(content, "utf8") / 1024));
    const preview = formatToolOutputPreview(content);
    const readArgs = JSON.stringify({ tool_use_id: toolUseId, offset: 0 });

    return `<persisted-output>
输出太大（${sizeKB}KB），完整内容已无损保存。
tool_use_id: ${toolUseId}
保存路径: ${path}

${preview}

如需完整内容，请调用 ReadToolResult：
${readArgs}
该工具会返回 next_offset；按 next_offset 继续读取，直到 next_offset 为 null。
</persisted-output>`;
}

export function persistToolResult(
    workDir: string,
    toolUseId: string,
    content: string,
): string {
    const path = saveToolResultToFile(workDir, toolUseId, content);
    return formatPersistedToolResult(content, path, toolUseId);
}

export function prepareToolResultForConversation(
    workDir: string,
    toolUseId: string,
    content: string,
    maxInlineChars: number,
): string {
    return content.length > maxInlineChars
        ? persistToolResult(workDir, toolUseId, content)
        : content;
}

export interface PersistedToolResultChunk {
    content: string;
    offset: number;
    endOffset: number;
    totalChars: number;
    nextOffset: number | null;
}

export function readPersistedToolResultChunk(
    workDir: string,
    toolUseId: string,
    offset: number,
    requestedLimit: number,
): PersistedToolResultChunk {
    const path = getPersistedToolResultPath(workDir, toolUseId);
    const content = readFileSync(path, "utf-8");
    try {
        const now = new Date();
        utimesSync(path, now, now);
    } catch {
        // Reading succeeded; cache recency refresh is best-effort.
    }
    const safeOffset = Math.min(Math.max(0, offset), content.length);
    const safeLimit = Math.min(Math.max(1, requestedLimit), TOOL_OUTPUT_CHUNK_CHARS);
    let endOffset = Math.min(safeOffset + safeLimit, content.length);

    // Do not split a UTF-16 surrogate pair across two chunks.
    if (
        endOffset < content.length
        && endOffset > safeOffset
        && content.charCodeAt(endOffset - 1) >= 0xD800
        && content.charCodeAt(endOffset - 1) <= 0xDBFF
    ) {
        endOffset--;
    }

    return {
        content: content.slice(safeOffset, endOffset),
        offset: safeOffset,
        endOffset,
        totalChars: content.length,
        nextOffset: endOffset < content.length ? endOffset : null,
    };
}
