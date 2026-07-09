import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { format } from "node:util";

const logsDir = resolve(process.cwd(), "logs");
const consoleLogPath = resolve(logsDir, "console.log");
const separator = "----------------------------------------";

export function writeLog(...args: unknown[]) {
    mkdirSync(logsDir, { recursive: true });
    appendFileSync(consoleLogPath, `${format(...args)}\n${separator}\n`, "utf8");
}

export default writeLog;
