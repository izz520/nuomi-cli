import { Box, Text } from "ink";
import React, { memo, useEffect, useRef, useState } from "react";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const LoadingMessage = ({ label = "Working" }: { label?: string }) => {
    const startedAtRef = useRef(Date.now());
    const [frame, setFrame] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => {
            setFrame((previous) => (previous + 1) % SPINNER_FRAMES.length);
        }, 80);

        return () => clearInterval(timer);
    }, []);

    const elapsedSeconds = Math.floor((Date.now() - startedAtRef.current) / 1000);

    return (
        <Box flexDirection="row" flexShrink={1} marginBottom={1}>
            <Box width={2} flexShrink={0}>
                <Text color="cyan">{SPINNER_FRAMES[frame]}</Text>
            </Box>
            <Text dimColor>{label}</Text>
            {elapsedSeconds > 0 && <Text dimColor>{` · ${elapsedSeconds}s`}</Text>}
            {elapsedSeconds >= 30 && <Text color="yellow">{` · Ctrl+C to stop`}</Text>}
        </Box>
    );
};

export default memo(LoadingMessage);
