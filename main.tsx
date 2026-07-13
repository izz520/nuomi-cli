import React from "react";
import { render } from "ink";
import App from "./src/App.js";

const { waitUntilExit } = render(<App />, {
    // 由 Chat 统一处理 Ctrl+C，确保退出前先取消正在进行的请求。
    exitOnCtrlC: false
});
await waitUntilExit();
