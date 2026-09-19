import { mountPreview, type PreviewHandle, type PreviewMode } from "../../src/lib/preview/mount";
import { buildExportHtml } from "../../src/lib/preview/export";
import { sourceHash, type Artifact, type AppData, type VersionDetail } from "../../src/lib/contracts";

const projectId = "10000000-0000-4000-8000-000000000001";
const versionId = "20000000-0000-4000-8000-000000000001";
let database: AppData = { state: {}, revision: 0, currentVersionId: versionId };
let handles: PreviewHandle[] = [];
const events: { type: string; value: unknown }[] = [];
let writeCount = 0;
const api = {
  events,
  snapshot: () => structuredClone(database),
  writes: () => writeCount,
  create(artifact: Artifact, mode: PreviewMode = "active", delay = 0, containerSelector?: string) {
    const iframe = document.createElement("iframe");
    iframe.id = "frame-" + handles.length; iframe.style.width = "600px"; iframe.style.height = "400px";
    (containerSelector ? document.querySelector(containerSelector)! : document.body).append(iframe);
    const handle = mountPreview(iframe, {
      artifact, mode, projectId, versionId,
      readData: async () => structuredClone(database),
      writeData: async (input) => {
        if (delay) await new Promise((r) => setTimeout(r, delay));
        if (input.versionId !== database.currentVersionId || input.expectedRevision !== database.revision)
          throw Object.assign(new Error("数据冲突"), { code: "DATA_REVISION_CONFLICT" });
        writeCount++; database = { ...database, state: structuredClone(input.state), revision: database.revision + 1 };
        return { revision: database.revision, savedAt: new Date().toISOString() };
      },
      onReady: (value) => events.push({ type: "ready", value }),
      onDiagnostic: (value) => events.push({ type: "diagnostic", value }),
      onPlatformError: (value) => events.push({ type: "platform", value }),
      onSaveStatus: (value) => events.push({ type: "save", value }),
    });
    handles.push(handle);
    return iframe.id;
  },
  freeze(index = 0) { handles[index].freezeWrites(); },
  drain(index = 0) { return handles[index].drainWrites(); },
  destroy(index = 0) { handles[index].destroy(); },
  reset() {
    handles.forEach((h) => h.destroy()); document.querySelectorAll("iframe").forEach((f) => f.remove()); handles = [];
    events.length = 0; writeCount = 0; database = { state: {}, revision: 0, currentVersionId: versionId };
  },
  async export(artifact: Artifact) {
    const version: VersionDetail = { id: versionId, projectId, runId: "30000000-0000-4000-8000-000000000001", number: 1,
      status: "ready", parentVersionId: null, restoredFromVersionId: null, summary: "fixture",
      sourceHash: await sourceHash(artifact), createdAt: new Date().toISOString(), committedAt: new Date().toISOString(),
      artifact, plan: { title: "fixture", brief: "fixture", features: ["计数"], changeSummary: "fixture" } };
    return buildExportHtml(projectId, version);
  },
};
Object.assign(window, { harness: api, parentSecret: "fixture-host-secret" });
