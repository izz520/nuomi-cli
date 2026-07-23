import assert from 'node:assert/strict'
import test from 'node:test'
import {
    backspacePromptValue,
    expandPromptPastes,
    insertPromptPaste,
    normalizePastedText,
    retainVisiblePromptPastes,
} from './prompt-paste.js'

test('normalizes pasted line endings', () => {
    assert.equal(normalizePastedText('one\r\ntwo\rthree'), 'one\ntwo\nthree')
})

test('inserts short pastes directly at the cursor', () => {
    const result = insertPromptPaste('before after', [], 'short text', 7)

    assert.equal(result.visibleValue, 'before short textafter')
    assert.deepEqual(result.pendingPastes, [])
})

test('replaces a large paste with a summary and expands it for submission', () => {
    const content = Array.from({ length: 12 }, (_, index) => `log line ${index + 1}`).join('\n')
    const result = insertPromptPaste('inspect ', [], content)

    assert.match(result.visibleValue, /^inspect \[Pasted text · 12 lines, \d+ chars\]$/)
    assert.equal(result.pendingPastes.length, 1)
    assert.equal(expandPromptPastes(result.visibleValue, result.pendingPastes), `inspect ${content}`)
})

test('uses unique placeholders for equally sized pastes', () => {
    const content = 'x'.repeat(1001)
    const first = insertPromptPaste('', [], content)
    const second = insertPromptPaste(first.visibleValue, first.pendingPastes, content)

    assert.notEqual(second.pendingPastes[0].placeholder, second.pendingPastes[1].placeholder)
    assert.equal(expandPromptPastes(second.visibleValue, second.pendingPastes), content + content)
})

test('drops pending content when its placeholder is deleted', () => {
    const content = 'x'.repeat(1001)
    const result = insertPromptPaste('', [], content)

    assert.deepEqual(retainVisiblePromptPastes('', result.pendingPastes), [])
})

test('backspace removes a paste placeholder as one atomic value', () => {
    const content = 'x'.repeat(1001)
    const result = insertPromptPaste('before after', [], content, 7)
    const placeholder = result.pendingPastes[0].placeholder
    const removed = backspacePromptValue(
        result.visibleValue,
        result.pendingPastes,
        7 + placeholder.length,
    )

    assert.equal(removed.visibleValue, 'before after')
    assert.equal(removed.cursorOffset, 7)
    assert.deepEqual(removed.pendingPastes, [])
})
