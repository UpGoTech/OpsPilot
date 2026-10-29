/** Format ms as Cursor-style "3m 9s" / "6s" / "Working…". */
export function formatWorkedFor(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 1) return "1s";
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m <= 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

export function activitySpanMs(steps: { startedAt?: number; endedAt?: number }[]): number | null {
  const starts = steps.map((s) => s.startedAt).filter((n): n is number => typeof n === "number");
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const ends = steps.map((s) => s.endedAt ?? Date.now());
  const end = Math.max(...ends);
  return Math.max(0, end - start);
}
