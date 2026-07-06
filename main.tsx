import React from "react";
import { render } from "ink";
import App from "./src/App.js";

const { waitUntilExit } = render(<App />, {
    exitOnCtrlC: true
});
await waitUntilExit();
