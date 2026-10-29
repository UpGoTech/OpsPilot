import type { ChatMessage } from "../types";

export function transcriptToMarkdown(
  title: string,
  messages: ChatMessage[],
): string {
  const lines = [`# ${title || "Chat transcript"}`, ""];
  for (const msg of messages) {
    const role =
      msg.role === "user"
        ? "You"
        : msg.role === "assistant"
          ? "Hermes"
          : msg.role;
    lines.push(`## ${role}`, "", msg.content || "", "");
  }
  return lines.join("\n");
}

export function downloadTextFile(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
