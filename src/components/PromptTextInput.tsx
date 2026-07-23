import { Text, useInput, usePaste } from 'ink'
import React from 'react'
import {
    backspacePromptValue,
    type PendingPromptPaste,
} from './prompt-paste.js'

interface PromptTextInputProps {
    value: string
    placeholder: string
    pendingPastes: readonly PendingPromptPaste[]
    onChange: (value: string) => void
    onPaste: (value: string, cursorOffset: number) => string
    onDeletePaste: (paste: PendingPromptPaste) => void
    onSubmit: (value: string) => void
}

const PromptTextInput = ({ value, placeholder, pendingPastes, onChange, onPaste, onDeletePaste, onSubmit }: PromptTextInputProps) => {
    const [cursorOffset, setCursorOffset] = React.useState(value.length)

    React.useEffect(() => {
        setCursorOffset((offset) => Math.min(offset, value.length))
    }, [value])

    usePaste((pastedValue) => {
        const nextValue = onPaste(pastedValue, cursorOffset)
        setCursorOffset(cursorOffset + nextValue.length - value.length)
    }, { isActive: true })

    useInput((input, key) => {
        if (key.upArrow || key.downArrow || (key.ctrl && input === 'c') || key.tab || (key.shift && key.tab)) return

        if (key.return) {
            onSubmit(value)
            return
        }

        if (key.leftArrow) {
            setCursorOffset(Math.max(0, cursorOffset - 1))
            return
        }

        if (key.rightArrow) {
            setCursorOffset(Math.min(value.length, cursorOffset + 1))
            return
        }

        if (key.backspace || key.delete) {
            const next = backspacePromptValue(value, pendingPastes, cursorOffset)
            const removedPaste = pendingPastes.find((paste) => !next.pendingPastes.includes(paste))
            if (removedPaste) onDeletePaste(removedPaste)
            if (next.visibleValue !== value) onChange(next.visibleValue)
            setCursorOffset(next.cursorOffset)
            return
        }

        if (!input) return
        onChange(value.slice(0, cursorOffset) + input + value.slice(cursorOffset))
        setCursorOffset(cursorOffset + input.length)
    })

    if (!value) {
        return <Text><Text inverse>{placeholder.slice(0, 1) || ' '}</Text><Text dimColor>{placeholder.slice(1)}</Text></Text>
    }

    return (
        <Text>
            {value.slice(0, cursorOffset)}
            <Text inverse>{value[cursorOffset] ?? ' '}</Text>
            {value.slice(cursorOffset + 1)}
        </Text>
    )
}

export default PromptTextInput
