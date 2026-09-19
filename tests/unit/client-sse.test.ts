import { describe, expect, it } from "vitest";
import { readSse, SseParser } from "../../src/lib/client/sse";

describe("client SSE framing (U-04)", () => {
  it("reconstructs Chinese across every UTF-8 byte, CRLF, comments and multiline data", async () => {
    const text = ': ping\r\n\r\nevent: snapshot\r\ndata: {"label":\r\ndata: "正在生成中文应用"}\r\n\r\nevent: unknown\ndata: ignored\n\nevent: stream_end\ndata: {"status":"awaiting_preview"}\n\n';
    const bytes = new TextEncoder().encode(text);
    const response = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } }), { headers: { "content-type": "text/event-stream" } });
    const received: unknown[] = [];
    await readSse(response, (event, data) => received.push([event, data]));
    expect(received).toEqual([["snapshot", { label: "正在生成中文应用" }], ["stream_end", { status: "awaiting_preview" }]]);
  });
  it("does not dispatch incomplete events or interpret stream close as success", () => {
    const received: string[] = [];
    const parser = new SseParser((event) => received.push(event));
    parser.push('event: committed\ndata: {"unfinished":');
    expect(received).toEqual([]);
  });
  it("rejects a successful HTTP response with the wrong content type", async () => {
    await expect(readSse(new Response("{}", { headers: { "content-type": "application/json" } }), () => undefined)).rejects.toThrow("协议");
  });
});
