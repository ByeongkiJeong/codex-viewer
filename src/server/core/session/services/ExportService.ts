import { Effect } from "effect";
import type { SessionDetail } from "../../types";

const escapeHtml = (text: string): string => {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
};

const renderLine = (line: SessionDetail["conversations"][number]) => {
  if (line.type === "x-error") {
    return `<article class="line error"><h3>Parse Error (line ${line.lineNumber})</h3><pre>${escapeHtml(line.line)}</pre></article>`;
  }

  const title = `${line.type} ${line.timestamp}`;
  const body = escapeHtml(JSON.stringify(line, null, 2));
  return `<article class="line"><h3>${escapeHtml(title)}</h3><pre>${body}</pre></article>`;
};

export const generateSessionHtml = (
  session: SessionDetail,
  projectId: string,
) =>
  Effect.sync(() => {
    const lines = session.conversations.map(renderLine).join("\n");
    const title = `Codex Session ${session.id}`;

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 24px; background: #fafafa; color: #222; }
    header { margin-bottom: 16px; }
    h1 { margin: 0; font-size: 20px; }
    .meta { margin-top: 6px; color: #666; font-size: 12px; }
    .line { background: #fff; border: 1px solid #e5e5e5; border-radius: 8px; padding: 12px; margin-bottom: 12px; }
    .line.error { border-color: #f6b4b4; background: #fff5f5; }
    .line h3 { margin: 0 0 8px; font-size: 13px; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.4; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">Project: ${escapeHtml(projectId)} | Exported: ${new Date().toISOString()}</div>
  </header>
  ${lines}
</body>
</html>`;
  });
