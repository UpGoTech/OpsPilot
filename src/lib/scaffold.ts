import { summarizeToolRun } from "./activityLabels";
import type { AgentActivity, ScaffoldSegment } from "../types";

function isThinking(step: AgentActivity): boolean {
  return step.toolName === "thinking";
}

function stdoutMeta(steps: AgentActivity[]): string | undefined {
  const withOut = [...steps].reverse().find((s) => s.output || s.outputBytes);
  if (!withOut) return undefined;
  const bytes =
    withOut.outputBytes ??
    (withOut.output ? new TextEncoder().encode(withOut.output).length : 0);
  if (!bytes) return undefined;
  return `${bytes} stdout_bytes`;
}

/**
 * Fold flat activity into Desktop scaffold rows:
 * Thought / Ran N commands / Thought / …
 */
export function buildScaffold(steps: AgentActivity[]): ScaffoldSegment[] {
  const segments: ScaffoldSegment[] = [];

  for (const step of steps) {
    if (isThinking(step)) {
      const last = segments[segments.length - 1];
      if (last?.kind === "thought") {
        last.text = step.detail || last.text;
        last.live = step.status === "running";
        if (step.startedAt && step.endedAt) {
          last.seconds = Math.max(
            1,
            Math.round((step.endedAt - step.startedAt) / 1000),
          );
        } else if (step.startedAt && step.status !== "running") {
          last.seconds = Math.max(
            1,
            Math.round((Date.now() - step.startedAt) / 1000),
          );
        }
      } else {
        segments.push({
          kind: "thought",
          id: step.id,
          text: step.detail || "",
          live: step.status === "running",
          seconds:
            step.startedAt && step.endedAt
              ? Math.max(1, Math.round((step.endedAt - step.startedAt) / 1000))
              : undefined,
        });
      }
      continue;
    }

    const last = segments[segments.length - 1];
    if (last?.kind === "tools") {
      const idx = last.steps.findIndex((s) => s.id === step.id);
      if (idx >= 0) last.steps[idx] = step;
      else last.steps.push(step);
      last.live = last.steps.some((s) => s.status === "running");
      last.summary = summarizeToolRun(last.steps, last.live);
      last.meta = stdoutMeta(last.steps);
    } else {
      const group = [step];
      const live = step.status === "running";
      segments.push({
        kind: "tools",
        id: step.id,
        steps: group,
        live,
        summary: summarizeToolRun(group, live),
        meta: stdoutMeta(group),
      });
    }
  }

  return segments;
}
