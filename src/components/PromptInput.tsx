import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'
import React, { memo } from 'react'
import { borderColors, symbols } from '../styles.js'

interface PromptInputProps {
    isWaiting?: boolean
    onSubmit?: (value: string) => void
}
const PromptInput = ({ isWaiting, onSubmit }: PromptInputProps) => {
    const [inputValue, setInputValue] = React.useState<string>('')
    const borderColor = borderColors.idle;
    const handleSubmit = (value: string) => {
        setInputValue('')
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
            {isWaiting ? <Text dimColor>Waiting</Text> : <TextInput value={inputValue} onChange={setInputValue} onSubmit={handleSubmit} placeholder="Enter your message..." />}

        </Box>
    )
}

export default memo(PromptInput)