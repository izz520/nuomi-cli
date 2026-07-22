import assert from 'node:assert/strict'
import test from 'node:test'
import { moveCommandListPosition } from './command-list-navigation.js'

test('moves the visible window when selection passes its last row', () => {
    const next = moveCommandListPosition(
        { selectedIndex: 7, windowStart: 0 },
        'next',
        17,
        8,
    )

    assert.deepEqual(next, { selectedIndex: 8, windowStart: 1 })
})

test('keeps the visible window stable while selection remains inside it', () => {
    const next = moveCommandListPosition(
        { selectedIndex: 10, windowStart: 5 },
        'previous',
        17,
        8,
    )

    assert.deepEqual(next, { selectedIndex: 9, windowStart: 5 })
})

test('wraps from first command to the final visible window', () => {
    const next = moveCommandListPosition(
        { selectedIndex: 0, windowStart: 0 },
        'previous',
        17,
        8,
    )

    assert.deepEqual(next, { selectedIndex: 16, windowStart: 9 })
})

test('wraps from last command back to the first window', () => {
    const next = moveCommandListPosition(
        { selectedIndex: 16, windowStart: 9 },
        'next',
        17,
        8,
    )

    assert.deepEqual(next, { selectedIndex: 0, windowStart: 0 })
})

test('preserves the latest selection across rapid consecutive moves', () => {
    let position = { selectedIndex: 0, windowStart: 0 }

    for (let index = 0; index < 7; index += 1) {
        position = moveCommandListPosition(position, 'next', 17, 8)
    }

    assert.deepEqual(position, { selectedIndex: 7, windowStart: 0 })
})
