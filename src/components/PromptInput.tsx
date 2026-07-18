import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import React, { memo } from 'react'
import { borderColors, symbols } from '../styles.js'
import { navigatePromptHistory } from '../history/send-message.js'

interface PromptInputProps {
    isWaiting?: boolean
    onSubmit?: (value: string) => void
    history?: readonly string[]
}
const PromptInput = ({ isWaiting, onSubmit, history = [] }: PromptInputProps) => {
    const [inputValue, setInputValue] = React.useState<string>('')
    const [inputRevision, setInputRevision] = React.useState(0)
    const inputValueRef = React.useRef('')
    const historyIndexRef = React.useRef<number | null>(null)
    const draftRef = React.useRef('')
    const borderColor = borderColors.idle;

    useInput((_input, key) => {
        if (isWaiting || (!key.upArrow && !key.downArrow)) return

        const next = navigatePromptHistory(history, {
            index: historyIndexRef.current,
            draft: draftRef.current,
            value: inputValueRef.current,
        }, key.upArrow ? "previous" : "next")

        draftRef.current = next.draft
        historyIndexRef.current = next.index
        inputValueRef.current = next.value
        setInputValue(next.value)
        setInputRevision((revision) => revision + 1)
    })

    const handleChange = (value: string) => {
        historyIndexRef.current = null
        draftRef.current = value
        inputValueRef.current = value
        setInputValue(value)
    }

    const handleSubmit = (value: string) => {
        if (!value.trim()) return
        setInputValue('')
        inputValueRef.current = ''
        historyIndexRef.current = null
        draftRef.current = ''
        onSubmit?.(value)
    }
    return (
        <Box borderStyle="round"
            borderTop={true}
            borderBottom={true}
            borderLeft={false}
            borderRight={false}
            borderColor={borderColor}>
            <Text>{symbols.prompt}{" "}</Text>
            {isWaiting ? <Text dimColor>Waiting</Text> : <TextInput key={inputRevision} value={inputValue} onChange={handleChange} onSubmit={handleSubmit} placeholder="Enter your message..." />}

        </Box>
    )
}

export default memo(PromptInput)
