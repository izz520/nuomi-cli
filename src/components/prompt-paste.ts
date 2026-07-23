export const LARGE_PASTE_CHARACTER_THRESHOLD = 1000
export const LARGE_PASTE_LINE_THRESHOLD = 10

export interface PendingPromptPaste {
    placeholder: string
    content: string
}

export interface PromptPasteResult {
    visibleValue: string
    pendingPastes: PendingPromptPaste[]
}

export interface PromptBackspaceResult extends PromptPasteResult {
    cursorOffset: number
}

export const normalizePastedText = (value: string): string =>
    value.replace(/\r\n/g, "\n").replace(/\r/g, "\n")

export const insertPromptPaste = (
    visibleValue: string,
    pendingPastes: readonly PendingPromptPaste[],
    pastedValue: string,
    cursorOffset = visibleValue.length,
): PromptPasteResult => {
    const content = normalizePastedText(pastedValue)
    const lineCount = content.split("\n").length
    const characterCount = [...content].length

    if (characterCount <= LARGE_PASTE_CHARACTER_THRESHOLD && lineCount <= LARGE_PASTE_LINE_THRESHOLD) {
        return {
            visibleValue: insertAt(visibleValue, content, cursorOffset),
            pendingPastes: [...pendingPastes],
        }
    }

    const placeholder = nextPlaceholder(lineCount, characterCount, pendingPastes)
    return {
        visibleValue: insertAt(visibleValue, placeholder, cursorOffset),
        pendingPastes: [...pendingPastes, { placeholder, content }],
    }
}

const insertAt = (value: string, insertedValue: string, cursorOffset: number): string => {
    const offset = Math.max(0, Math.min(cursorOffset, value.length))
    return value.slice(0, offset) + insertedValue + value.slice(offset)
}

export const expandPromptPastes = (
    visibleValue: string,
    pendingPastes: readonly PendingPromptPaste[],
): string => pendingPastes.reduce(
    (value, paste) => value.split(paste.placeholder).join(paste.content),
    visibleValue,
)

export const retainVisiblePromptPastes = (
    visibleValue: string,
    pendingPastes: readonly PendingPromptPaste[],
): PendingPromptPaste[] => pendingPastes.filter((paste) => visibleValue.includes(paste.placeholder))

export const backspacePromptValue = (
    visibleValue: string,
    pendingPastes: readonly PendingPromptPaste[],
    cursorOffset: number,
): PromptBackspaceResult => {
    if (cursorOffset <= 0) {
        return { visibleValue, pendingPastes: [...pendingPastes], cursorOffset }
    }

    const paste = pendingPastes.find(({ placeholder }) => {
        const start = visibleValue.indexOf(placeholder)
        return start >= 0 && cursorOffset > start && cursorOffset <= start + placeholder.length
    })

    if (paste) {
        const start = visibleValue.indexOf(paste.placeholder)
        return {
            visibleValue: visibleValue.slice(0, start) + visibleValue.slice(start + paste.placeholder.length),
            pendingPastes: pendingPastes.filter((candidate) => candidate !== paste),
            cursorOffset: start,
        }
    }

    const nextValue = visibleValue.slice(0, cursorOffset - 1) + visibleValue.slice(cursorOffset)
    return {
        visibleValue: nextValue,
        pendingPastes: retainVisiblePromptPastes(nextValue, pendingPastes),
        cursorOffset: cursorOffset - 1,
    }
}

const nextPlaceholder = (
    lineCount: number,
    characterCount: number,
    pendingPastes: readonly PendingPromptPaste[],
): string => {
    const summary = lineCount > 1
        ? `${lineCount} lines, ${characterCount} chars`
        : `${characterCount} chars`
    const prefix = `[Pasted text · ${summary}`
    let suffix = ""
    let index = 2

    while (pendingPastes.some((paste) => paste.placeholder === `${prefix}${suffix}]`)) {
        suffix = ` #${index}`
        index += 1
    }

    return `${prefix}${suffix}]`
}
