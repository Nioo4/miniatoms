/** Incremental SSE framing; UTF-8 decoding belongs to the stream reader. */
export class SseParser {
  private buffer = "";
  constructor(private receive: (event: string, data: string) => void) {}
  push(text: string) {
    this.buffer += text;
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
      const frame = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      let event = "message";
      const data: string[] = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") event = value;
        if (field === "data") data.push(value);
      }
      if (data.length) this.receive(event, data.join("\n"));
    }
  }
}

export async function readSse(response: Response, receive: (event: string, value: unknown) => void) {
  if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) throw new Error("响应协议异常，正在确认任务结果。");
  const parser = new SseParser((event, data) => {
    if (!["snapshot", "stage", "plan", "candidate", "committed", "terminal", "stream_end"].includes(event)) return;
    receive(event, JSON.parse(data));
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
  } finally { reader.releaseLock(); }
}
