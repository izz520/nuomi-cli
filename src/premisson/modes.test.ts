import assert from 'node:assert/strict'
import test from 'node:test'
import { nextPermissionMode } from './modes.js'

test('cycles through permission modes and returns to default', () => {
    assert.equal(nextPermissionMode('default'), 'acceptEdits')
    assert.equal(nextPermissionMode('acceptEdits'), 'plan')
    assert.equal(nextPermissionMode('plan'), 'bypassPermissions')
    assert.equal(nextPermissionMode('bypassPermissions'), 'default')
})
