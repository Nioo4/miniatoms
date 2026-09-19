import { describe, expect, it, vi } from "vitest";
import { FeedbackOutbox } from "../../src/lib/client/feedback-outbox";
import type { Feedback } from "../../src/lib/contracts";

const context = (candidateId = "c1", runId = "run", identity = "owner") => ({ identity, projectId: "project", runId, candidateId, active: true });
const report = (candidateVersionId = "c1", requestId = "receipt-1"): Feedback => ({ requestId, candidateVersionId, sourceHash: "a".repeat(64), dataRevision: 1, outcome: "ready", diagnostics: [] });
const deferred = () => { let resolve!: () => void; let reject!: (error: unknown) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

describe("candidate feedback outbox", () => {
  it("keeps a second candidate conclusion until the previous repair response finishes", async () => {
    const first = deferred();
    const send = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const box = new FeedbackOutbox({ send, dataChanged: vi.fn(), error: vi.fn() });
    box.setContext(context()); box.submit(report()); await Promise.resolve();
    box.setContext(context("c2")); box.submit(report("c2", "receipt-2"));
    expect(send).toHaveBeenCalledTimes(1);
    first.resolve(); await box.settled();
    expect(send).toHaveBeenNthCalledWith(2, "run", report("c2", "receipt-2"));
  });
  it("replays the exact receipt and payload after an uncertain transport failure", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("lost response")).mockResolvedValue(undefined);
    const box = new FeedbackOutbox({ send, dataChanged: vi.fn(), error: vi.fn() });
    box.setContext(context()); box.submit(report()); await box.settled();
    box.submit({ ...report("c1", "different-id"), dataRevision: 42 }); await box.settled();
    expect(send).toHaveBeenNthCalledWith(2, "run", report());
  });
  it("only permits a new report after PREVIEW_DATA_CHANGED rejects the old receipt", async () => {
    const changed = vi.fn();
    const send = vi.fn().mockRejectedValueOnce({ code: "PREVIEW_DATA_CHANGED" }).mockResolvedValue(undefined);
    const box = new FeedbackOutbox({ send, dataChanged: changed, error: vi.fn() });
    box.setContext(context()); box.submit(report()); await box.settled();
    box.submit({ ...report("c1", "receipt-2"), dataRevision: 2 }); await box.settled();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[1][1]).toMatchObject({ requestId: "receipt-2", dataRevision: 2 });
  });
  it.each(["cancel", "identity", "run"])("drops queued old reports after %s without blocking a new context", async kind => {
    const first = deferred(); const error = vi.fn();
    const send = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const box = new FeedbackOutbox({ send, dataChanged: vi.fn(), error });
    box.setContext(context()); box.submit(report()); await Promise.resolve();
    box.setContext(context("c2")); box.submit(report("c2", "receipt-2"));
    if (kind === "cancel") box.setContext({ ...context("c2"), active: false });
    const next = context("c3", "run-next", kind === "identity" ? "owner-next" : "owner");
    box.setContext(next); box.submit(report("c3", "receipt-3")); await box.settled();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith("run-next", report("c3", "receipt-3"));
    first.reject(new Error("late old error")); await Promise.resolve(); await Promise.resolve();
    expect(error).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
