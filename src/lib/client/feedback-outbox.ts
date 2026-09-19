import type { Feedback } from "@/lib/contracts";

type Context = { identity: string; projectId: string; runId: string; candidateId: string | null; active: boolean; isCurrent?: () => boolean };
type Report = { context: Context; body: Feedback; state: "queued" | "sending" | "failed" | "done"; epoch: number };
type Callbacks = {
  send: (runId: string, body: Feedback) => Promise<void>;
  dataChanged: () => void;
  error: (error: unknown) => void;
};

/** Retains observed conclusions while an earlier repair response is still streaming. */
export class FeedbackOutbox {
  private context: Context | null = null;
  private reports = new Map<string, Report>();
  private tail = Promise.resolve();
  private epoch = 0;
  constructor(private callbacks: Callbacks) {}

  setContext(next: Context) {
    const old = this.context;
    if (!next.active || old?.identity !== next.identity || old?.projectId !== next.projectId || old?.runId !== next.runId) {
      this.epoch++; this.reports.clear(); this.tail = Promise.resolve();
    }
    this.context = next;
  }
  dispose() { this.epoch++; this.context = null; this.reports.clear(); this.tail = Promise.resolve(); }
  private current(report: Report) {
    return report.context.isCurrent?.() !== false && report.epoch === this.epoch && this.context?.active && this.context.candidateId === report.body.candidateVersionId;
  }
  submit(body: Feedback) {
    if (!this.context?.active || this.context.isCurrent?.() === false || this.context.candidateId !== body.candidateVersionId) return;
    let report = this.reports.get(body.candidateVersionId);
    if (report && report.state !== "failed") return;
    if (!report) {
      report = { context: { ...this.context }, body, state: "queued", epoch: this.epoch };
      this.reports.set(body.candidateVersionId, report);
    }
    // An uncertain transport retry must reuse the exact original request and payload.
    report.state = "queued";
    const next = report;
    this.tail = this.tail.then(async () => {
      if (!this.current(next)) return;
      next.state = "sending";
      try {
        await this.callbacks.send(next.context.runId, next.body);
        if (next.epoch === this.epoch) next.state = "done";
      } catch (error) {
        if (!this.current(next)) return;
        if (error && typeof error === "object" && "code" in error && error.code === "PREVIEW_DATA_CHANGED") {
          this.reports.delete(next.body.candidateVersionId);
          this.callbacks.dataChanged();
        } else { next.state = "failed"; this.callbacks.error(error); }
      }
    });
  }
  settled() { return this.tail; }
}
