import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import React, { memo } from 'react'
import { borderColors, symbols } from '../styles.js'
import { navigatePromptHistory } from '../history/send-message.js'
import type { Command } from '../commands/commands.js'
import type { PermissionMode } from '../premisson/checker.js'
import CommandList from './CommandList.js'
import PermissionModeIndicator from './PermissionModeIndicator.js'

interface PromptInputProps {
    isWaiting?: boolean
    onSubmit?: (value: string) => void
    commands: Command[]
    history?: readonly string[]
    permissionMode?: PermissionMode
}

const PromptInput = ({ isWaiting, onSubmit, commands = [], history = [], permissionMode = 'default' }: PromptInputProps) => {
    const [inputValue, setInputValue] = React.useState<string>('')
    const [inputRevision, setInputRevision] = React.useState(0)
    const [isCommandListDismissed, setIsCommandListDismissed] = React.useState(false)
    const inputValueRef = React.useRef('')
    const historyIndexRef = React.useRef<number | null>(null)
    const draftRef = React.useRef('')
    const borderColor = borderColors.idle;

    const commandQuery = inputValue.startsWith('/') && !/\s/.test(inputValue)
        ? inputValue.slice(1).toLowerCase()
        : null
    const matchingCommands = React.useMemo(() => {
        if (commandQuery === null) return []

        return commands.filter((command) =>
            command.name.toLowerCase().startsWith(commandQuery)
            || command.aliases.some((alias) => alias.toLowerCase().startsWith(commandQuery))
        )
    }, [commands, commandQuery])
    const isCommandListOpen = !isWaiting
        && !isCommandListDismissed
        && commandQuery !== null
        && matchingCommands.length > 0

    const handleChange = (value: string) => {
        historyIndexRef.current = null
        draftRef.current = value
        inputValueRef.current = value
        setIsCommandListDismissed(false)
        setInputValue(value)
    }

    const completeCommand = (command: Command) => {
        const completedValue = `/${command.name} `
        historyIndexRef.current = null
        inputValueRef.current = completedValue
        draftRef.current = completedValue
        setInputValue(completedValue)
        setIsCommandListDismissed(true)
        setInputRevision((revision) => revision + 1)
    }

    useInput((_input, key) => {
        if (!key.upArrow && !key.downArrow) return

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
    }, { isActive: !isWaiting && !isCommandListOpen })

    const handleSubmit = (value: string) => {
        if (!value.trim()) return
        setInputValue('')
        inputValueRef.current = ''
        historyIndexRef.current = null
        draftRef.current = ''
        onSubmit?.(value)
    }
    return (
        <Box flexDirection="column">
            <Box borderStyle="round"
                borderTop={true}
                borderBottom={true}
                borderLeft={false}
                borderRight={false}
                borderColor={borderColor}>
                <Text>{symbols.prompt}{" "}</Text>
                {isWaiting
                    ? <Text dimColor>Waiting</Text>
                    : isCommandListOpen
                        ? <Text>{inputValue}<Text inverse>{' '}</Text></Text>
                        : <TextInput key={inputRevision} value={inputValue} onChange={handleChange} onSubmit={handleSubmit} placeholder="Enter your message..." />}
            </Box>
            {isCommandListOpen && (
                <CommandList
                    key={commandQuery}
                    commands={matchingCommands}
                    onSelect={completeCommand}
                    onDismiss={() => setIsCommandListDismissed(true)}
                    onBackspace={() => handleChange(inputValueRef.current.slice(0, -1))}
                    onInput={(input) => handleChange(inputValueRef.current + input)}
                />
            )}
            <PermissionModeIndicator mode={permissionMode} />
        </Box>
    )
}

export default memo(PromptInput)
