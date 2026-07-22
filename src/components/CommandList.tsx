import { Box, Text, useInput } from 'ink'
import React from 'react'
import type { Command } from '../commands/commands.js'
import { commandIcons, symbols } from '../styles.js'
import { moveCommandListPosition } from './command-list-navigation.js'

const MAX_VISIBLE_COMMANDS = 8

interface CommandListProps {
    commands: Command[]
    onSelect: (command: Command) => void
    onDismiss: () => void
    onInput: (input: string) => void
    onBackspace: () => void
}

const CommandList = ({ commands, onSelect, onDismiss, onInput, onBackspace }: CommandListProps) => {
    const initialPosition = { selectedIndex: 0, windowStart: 0 }
    const [position, setPosition] = React.useState(initialPosition)
    const positionRef = React.useRef(initialPosition)
    const visibleCommands = commands.slice(position.windowStart, position.windowStart + MAX_VISIBLE_COMMANDS)
    const hiddenBeforeCount = position.windowStart
    const hiddenAfterCount = commands.length - position.windowStart - visibleCommands.length

    useInput((input, key) => {
        if (key.upArrow) {
            const next = moveCommandListPosition(
                positionRef.current,
                'previous',
                commands.length,
                MAX_VISIBLE_COMMANDS,
            )
            positionRef.current = next
            setPosition(next)
            return
        }

        if (key.downArrow) {
            const next = moveCommandListPosition(
                positionRef.current,
                'next',
                commands.length,
                MAX_VISIBLE_COMMANDS,
            )
            positionRef.current = next
            setPosition(next)
            return
        }

        if (key.return || key.tab) {
            const selectedCommand = commands[positionRef.current.selectedIndex]
            if (selectedCommand) onSelect(selectedCommand)
            return
        }

        if (key.escape) return onDismiss()
        if (key.backspace || key.delete) return onBackspace()
        if (input && !key.ctrl && !key.meta) onInput(input)
    })

    return (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
            {hiddenBeforeCount > 0 && (
                <Text dimColor>{'  '}… {hiddenBeforeCount} previous commands</Text>
            )}
            {visibleCommands.map((command, visibleIndex) => {
                const commandIndex = position.windowStart + visibleIndex
                const isSelected = commandIndex === position.selectedIndex
                const aliases = command.aliases.length > 0
                    ? ` /${command.aliases.join(', /')}`
                    : ''

                return (
                    <Box key={command.name}>
                        <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                            {isSelected ? symbols.arrow : ' '} {commandIcons[command.type] ?? symbols.dot} /{command.name}
                        </Text>
                        <Text dimColor>{aliases}  {command.description}</Text>
                    </Box>
                )
            })}
            {hiddenAfterCount > 0 && (
                <Text dimColor>{'  '}… {hiddenAfterCount} more commands</Text>
            )}
            <Text dimColor>{'  '}↑↓ select  Enter/Tab complete  Esc close</Text>
        </Box>
    )
}

export default React.memo(CommandList)
