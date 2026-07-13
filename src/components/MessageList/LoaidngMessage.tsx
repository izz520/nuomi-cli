import { Box, Text } from 'ink';
import React, { memo, useEffect, useState } from "react";

const LoadingMessage = ({ label = "Working" }: { label?: string }) => {
    const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

    const [frame, setFrame] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => {
            setFrame(previous => previous + 1);
        }, 80);

        return () => {
            clearInterval(timer);
        };
    }, []);

    return (
        <Box flexDirection="row" flexShrink={1} marginBottom={1} flexGrow={1}>
            <Box width={2} flexShrink={0}>
                <Text color="gray">{spinnerFrames[frame % spinnerFrames.length]}</Text>
            </Box>
            <Box flexShrink={1} flexGrow={1}>
                <Text color="gray">{label} ({Math.floor(frame / 12.5)}s)</Text>
            </Box>
        </Box>
    );
};

export default memo(LoadingMessage)
