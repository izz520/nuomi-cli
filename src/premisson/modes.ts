import type { PermissionMode } from './checker.js'

export const PERMISSION_MODE_ORDER: readonly PermissionMode[] = [
    'default',
    'acceptEdits',
    'plan',
    'bypassPermissions',
]

export function nextPermissionMode(currentMode: PermissionMode): PermissionMode {
    const currentIndex = PERMISSION_MODE_ORDER.indexOf(currentMode)
    return PERMISSION_MODE_ORDER[(currentIndex + 1) % PERMISSION_MODE_ORDER.length]
}
