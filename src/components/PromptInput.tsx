import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'
import React, { memo } from 'react'
import { symbols } from '../styles.js'

interface PromptInputProps {
    onSubmit?: (value: string) => void
}
const PromptInput = ({ onSubmit }: PromptInputProps) => {
    const [inputValue, setInputValue] = React.useState<string>('')

    const handleSubmit = (value: string) => {
        setInputValue('')
        onSubmit?.(value)
    }
    return (
        <Box>
            <Text>{symbols.prompt}{" "}</Text>
            <TextInput value={inputValue} onChange={setInputValue} onSubmit={handleSubmit} placeholder="Enter your message..." />
        </Box>
    )
}

export default memo(PromptInput)