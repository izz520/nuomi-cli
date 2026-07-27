import React, { memo } from "react";
import { Box, Text } from "ink";
import type { SubAgentTaskSnapshot } from "../subAgent/task-manager.js";
import { symbols } from "../styles.js";

interface SubAgentStatusListProps {
  tasks: SubAgentTaskSnapshot[];
}

export const formatSubAgentProgress = (task: SubAgentTaskSnapshot): string => {
  if (task.status !== "running") return task.status;
  return [
    `turn ${task.turn}`,
    task.lastTool ? task.lastTool : "",
  ].filter(Boolean).join(" · ");
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

  return (
    <Box flexDirection="column" marginBottom={1}>
      {tasks.slice(-5).map((task) => {
        const style = statusStyle(task.status);
        const progress = formatSubAgentProgress(task);

        return (
          <Box key={task.id} flexDirection="row" flexShrink={1}>
            <Box width={2} flexShrink={0}>
              <Text color={style.color}>{style.icon}</Text>
            </Box>
            <Text dimColor>
              {task.id} · {task.label} · {progress}
              {task.background ? " · background" : ""}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};

export default memo(SubAgentStatusList);
