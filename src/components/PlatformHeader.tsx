import { Box, Text } from 'ink';
import React, { memo } from 'react'
import { brand } from '../styles.js';

const nuomiMascot = [
    { art: "  _   _                               _ ", gap: "    " },
    { art: " | \\ | |  _   _    ___    _ __ ___   (_)", gap: "    " },
    { art: " |  \\| | | | | |  / _ \\  | '_ ` _ \\  | |", gap: "    " },
    { art: " | |\\  | | |_| | | (_) | | | | | | | | |", gap: "    " },
    { art: " |_| \\_|  \\__,_|  \\___/  |_| |_| |_| |_|", gap: "    " }
] as const;

const selectedProvider = {
    name: "Claude Code",
    model: "claude-opus-4.8"
} as const;

const PlatformHeader = () => {
    const workDir = process.cwd();
    return (
        <Box paddingLeft={1} flexDirection="column">
            {nuomiMascot.map((line, index) => (
                <Text key={line.art}>
                    {brand.primary(line.art)}
                    {line.gap}
                    {index === 2 && (
                        <>
                            {brand.primary("Nuomi CLI")}{" "}
                            <Text dimColor>v1.0.0</Text>
                        </>
                    )}
                    {index === 3 && (
                        <Text dimColor>{selectedProvider.model || selectedProvider.name}</Text>
                    )}
                    {index === 4 && (
                        <Text dimColor>{workDir}</Text>
                    )}
                </Text>
            ))}
            {/* <Text>───────────────────────────────────────────────────────────────────────────────</Text> */}
        </Box>
    )
}

export default memo(PlatformHeader)