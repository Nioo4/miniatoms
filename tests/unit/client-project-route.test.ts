import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/workbench", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
import ProjectPage from "../../src/app/projects/[id]/page";

describe("project route identity", () => {
  it("keys the entire workbench by the normalized project id", async () => {
    const a = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
    const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const first = await ProjectPage({ params: Promise.resolve({ id: a }) });
    const second = await ProjectPage({ params: Promise.resolve({ id: b }) });
    expect(first.key).toBe(a.toLowerCase());
    expect(first.props.projectId).toBe(a.toLowerCase());
    expect(second.key).toBe(b);
    expect(second.key).not.toBe(first.key);
  });
  it("does not mount a workbench for an invalid project URL", async () => {
    await expect(ProjectPage({ params: Promise.resolve({ id: "not-a-project" }) })).rejects.toThrow("NOT_FOUND");
  });
});
