export interface CommandListPosition {
    selectedIndex: number
    windowStart: number
}

export type CommandListDirection = 'previous' | 'next'

export function moveCommandListPosition(
    position: CommandListPosition,
    direction: CommandListDirection,
    commandCount: number,
    windowSize: number,
): CommandListPosition {
    if (commandCount <= 0 || windowSize <= 0) {
        return { selectedIndex: 0, windowStart: 0 }
    }

    const selectedIndex = direction === 'previous'
        ? (position.selectedIndex === 0 ? commandCount - 1 : position.selectedIndex - 1)
        : (position.selectedIndex === commandCount - 1 ? 0 : position.selectedIndex + 1)

    let windowStart = position.windowStart
    if (selectedIndex < windowStart) {
        windowStart = selectedIndex
    } else if (selectedIndex >= windowStart + windowSize) {
        windowStart = selectedIndex - windowSize + 1
    }

    return { selectedIndex, windowStart }
}
