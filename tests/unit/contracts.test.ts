import { describe, expect, it } from "vitest";
import { appStateSchema, canTransition, canonicalJson, sourceHash, startRunSchema } from "@/lib/contracts";

describe("public trust boundaries", () => {
  it("rejects inherited/dangerous keys, oversize UTF-8, depth and non-JSON values", () => {
    for (const value of [JSON.parse('{"__proto__":{}}'), { x: Infinity }, { x: new Date() }, { x: "中".repeat(23000) }])
      expect(appStateSchema.safeParse(value).success).toBe(false);
    let nested: unknown = {};
    for (let i = 0; i < 22; i++) nested = { x: nested };
    expect(appStateSchema.safeParse(nested).success).toBe(false);
    expect(appStateSchema.parse({ jobs: [], total: 0 })).toEqual({ jobs: [], total: 0 });
  });
  it("counts Unicode code points and rejects unknown command fields", () => {
    const valid = { requestId: crypto.randomUUID(), baseVersionId: null, prompt: "🚀".repeat(4000) };
    expect(startRunSchema.safeParse(valid).success).toBe(true);
    expect(startRunSchema.safeParse({ ...valid, prompt: valid.prompt + "中" }).success).toBe(false);
    expect(startRunSchema.safeParse({ ...valid, ownerId: "other" }).success).toBe(false);
  });
  it("keeps source bytes significant and normalizes state keys only", async () => {
    const source = { html: "<p>Hi</p>", css: "", js: "await appStore.getState();" };
    expect(await sourceHash(source)).not.toBe(await sourceHash({ ...source, js: source.js + " " }));
    expect(canonicalJson({ b: 2, a: { x: 1, y: 2 } })).toBe(canonicalJson({ a: { y: 2, x: 1 }, b: 2 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
  it("cannot leave terminal states or generate while restoring", () => {
    expect(canTransition("succeeded", "failed")).toBe(false);
    expect(canTransition("cancelled", "generating")).toBe(false);
    expect(canTransition("validating", "repairing", "restore")).toBe(false);
    expect(canTransition("awaiting_preview", "succeeded", "restore")).toBe(true);
  });
});
