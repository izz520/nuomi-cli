import assert from "node:assert/strict"
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
    navigatePromptHistory,
    SendMessageHistory,
    type PromptHistoryNavigationState,
} from "./send-message.js"

test("persists prompts as JSONL and reloads multiline content", () => {
    const directory = mkdtempSync(join(tmpdir(), "nuomi-send-history-"))
    const path = join(directory, "nested", "send-history.jsonl")
    const history = new SendMessageHistory(path)

    history.sendMessage("first prompt")
    history.sendMessage("second\nprompt")

    assert.deepEqual(history.getAllMessage(), ["first prompt", "second\nprompt"])
    assert.deepEqual(new SendMessageHistory(path).getAllMessage(), [
        "first prompt",
        "second\nprompt",
    ])
    assert.equal(
        readFileSync(path, "utf8"),
        '{"text":"first prompt"}\n{"text":"second\\nprompt"}\n',
    )
})

test("ignores malformed history records while loading valid prompts", () => {
    const directory = mkdtempSync(join(tmpdir(), "nuomi-send-history-"))
    const path = join(directory, "send-history.jsonl")
    const history = new SendMessageHistory(path)
    history.sendMessage("valid")
    appendFileSync(path, "not-json\n42\n")

    assert.deepEqual(new SendMessageHistory(path).getAllMessage(), ["valid"])
})

test("navigates through prompts and restores the original draft at the newest boundary", () => {
    const history = ["我是谁", "我在哪里", "我有什么偏好"]
    let state: PromptHistoryNavigationState = {
        index: null,
        draft: "",
        value: "我是你爹",
    }

    state = navigatePromptHistory(history, state, "previous")
    assert.deepEqual(state, { index: 2, draft: "我是你爹", value: "我有什么偏好" })

    state = navigatePromptHistory(history, state, "previous")
    assert.deepEqual(state, { index: 1, draft: "我是你爹", value: "我在哪里" })

    state = navigatePromptHistory(history, state, "previous")
    assert.deepEqual(state, { index: 0, draft: "我是你爹", value: "我是谁" })

    state = navigatePromptHistory(history, state, "previous")
    assert.deepEqual(state, { index: 0, draft: "我是你爹", value: "我是谁" })

    state = navigatePromptHistory(history, state, "next")
    assert.deepEqual(state, { index: 1, draft: "我是你爹", value: "我在哪里" })

    state = navigatePromptHistory(history, state, "next")
    assert.deepEqual(state, { index: 2, draft: "我是你爹", value: "我有什么偏好" })

    state = navigatePromptHistory(history, state, "next")
    assert.deepEqual(state, { index: null, draft: "", value: "我是你爹" })

    state = navigatePromptHistory(history, state, "next")
    assert.deepEqual(state, { index: null, draft: "", value: "我是你爹" })
})

test("restores an empty draft after leaving the newest history entry", () => {
    const history = ["我是谁", "我在哪里", "我有什么偏好"]
    let state: PromptHistoryNavigationState = { index: null, draft: "", value: "" }

    state = navigatePromptHistory(history, state, "previous")
    assert.equal(state.value, "我有什么偏好")

    state = navigatePromptHistory(history, state, "next")
    assert.deepEqual(state, { index: null, draft: "", value: "" })
})
