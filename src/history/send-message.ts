/**
 * 记录用户发送的消息
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export type HistoryDirection = "previous" | "next"

export interface PromptHistoryNavigationState {
    index: number | null
    draft: string
    value: string
}

interface PromptHistoryRecord {
    text: string
}

export const navigatePromptHistory = (
    history: readonly string[],
    state: PromptHistoryNavigationState,
    direction: HistoryDirection,
): PromptHistoryNavigationState => {
    if (history.length === 0) return state

    if (direction === "previous") {
        const index = state.index === null
            ? history.length - 1
            : Math.max(0, state.index - 1)

        return {
            index,
            draft: state.index === null ? state.value : state.draft,
            value: history[index],
        }
    }

    if (state.index === null) return state
    if (state.index < history.length - 1) {
        const index = state.index + 1
        return { ...state, index, value: history[index] }
    }

    return { index: null, draft: "", value: state.draft }
}

export class SendMessageHistory {
    private readonly path: string
    private history: string[] = []

    constructor(path = join(homedir(), ".nuomi", "send-history.jsonl")) {
        this.path = path
        this.loadAll()
    }

    private loadAll(): void {
        try {
            const content = readFileSync(this.path, "utf8")
            this.history = content
                .split("\n")
                .filter(Boolean)
                .flatMap((line) => {
                    try {
                        const record: unknown = JSON.parse(line)
                        if (isPromptHistoryRecord(record)) return [record.text]
                        return []
                    } catch {
                        return []
                    }
                })
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        }
    }

    sendMessage(context: string): void {
        this.history.push(context)
        mkdirSync(dirname(this.path), { recursive: true })
        const record: PromptHistoryRecord = { text: context }
        appendFileSync(this.path, `${JSON.stringify(record)}\n`, "utf8")
    }

    getAllMessage(): readonly string[] {
        return [...this.history]
    }
}

const isPromptHistoryRecord = (value: unknown): value is PromptHistoryRecord =>
    typeof value === "object"
    && value !== null
    && typeof (value as Record<string, unknown>).text === "string"
