import { Box, Text } from 'ink'
import React from 'react'
import type { PermissionMode } from '../premisson/checker.js'

interface PermissionModeIndicatorProps {
    mode: PermissionMode
}

const modePresentation = (mode: Exclude<PermissionMode, 'default'>) => {
    switch (mode) {
        case 'acceptEdits':
            return { icon: '▶▶', label: 'accept edits on', color: 'magenta' as const }
        case 'plan':
            return { icon: 'Ⅱ', label: 'plan mode on', color: 'cyan' as const }
        case 'bypassPermissions':
            return { icon: '▶▶', label: 'bypass permissions on', color: 'yellow' as const }
    }
}

const PermissionModeIndicator = ({ mode }: PermissionModeIndicatorProps) => {
    if (mode === 'default') return null

    const presentation = modePresentation(mode)
    return (
        <Box marginLeft={2}>
            <Text color={presentation.color} bold>
                {presentation.icon} {presentation.label}
            </Text>
            <Text dimColor> (shift+tab to cycle)</Text>
        </Box>
    )
}

export default React.memo(PermissionModeIndicator)
