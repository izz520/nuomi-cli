import React, { memo } from "react";
import { Box, Text } from "ink";
import type { SubAgentTaskSnapshot } from "../subAgent/task-manager.js";
import { symbols } from "../styles.js";
import LoadingMessage from "./MessageList/LoadingMessage.js";

interface SubAgentStatusListProps {
  tasks: SubAgentTaskSnapshot[];
}

export const formatSubAgentProgress = (task: SubAgentTaskSnapshot): string => {
  if (task.status !== "running") return task.status;
  return [
    `turn ${task.turn}`,
    task.lastTool ? `using ${task.lastTool}` : "",
  ].filter(Boolean).join(" · ");
};

export const formatSubAgentElapsed = (task: SubAgentTaskSnapshot, now = Date.now()): string => {
  const elapsed = Math.max(0, (task.finishedAt ?? now) - task.startedAt);
  if (elapsed < 1000) return `${Math.max(1, Math.round(elapsed))}ms`;
  return `${(elapsed / 1000).toFixed(1)}s`;
};

const statusStyle = (status: SubAgentTaskSnapshot["status"]) => {
  switch (status) {
    case "completed":
      return { icon: symbols.success, color: "green" as const };
    case "failed":
      return { icon: symbols.error, color: "red" as const };
    case "cancelled":
      return { icon: symbols.denied, color: "yellow" as const };
    default:
      return { icon: symbols.tool, color: "cyan" as const };
  }
};

const SubAgentStatusList = ({ tasks }: SubAgentStatusListProps) => {
  if (tasks.length === 0) return null;

  const visibleTasks = tasks.slice(-5);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>{`Sub-agents (${visibleTasks.length})`}</Text>
      {visibleTasks.map((task) => {
        const style = statusStyle(task.status);
        const progress = formatSubAgentProgress(task);
        const label = `${task.label} · ${task.id} · ${progress}${task.background ? " · background" : ""}`;

        if (task.status === "running") {
          return (
            <Box key={task.id} paddingLeft={2}>
              <LoadingMessage label={label} marginBottom={0} />
            </Box>
          );
        }

        return (
          <Box key={task.id} flexDirection="row" flexShrink={1} paddingLeft={2}>
            <Box width={2} flexShrink={0}>
              <Text color={style.color}>{style.icon}</Text>
            </Box>
            <Text dimColor>
              {label} · {formatSubAgentElapsed(task)}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};

export default memo(SubAgentStatusList);
