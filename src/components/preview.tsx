"use client";

import { useEffect, useRef, type RefObject } from "react";
import { appDataSchema, sourceHash, type Diagnostic, type VersionDetail } from "@/lib/contracts";
import { apiJson } from "@/lib/client/api";
import { mountPreview } from "@/lib/preview/mount";

export type PreviewControl = ReturnType<typeof mountPreview>;
type Props = {
  version: VersionDetail; mode: "active" | "history" | "probe";
  control?: RefObject<PreviewControl | null>;
  beforeStart?: () => Promise<void>;
  onResult?: (revision: number, diagnostics: Diagnostic[]) => void;
  onError: (message: string) => void;
  onDiagnostic?: (diagnostic: Diagnostic) => void;
  onSaveStatus?: (status: "saving" | "saved" | "error", message?: string) => void;
};
export function Preview(props: Props) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const callbacks = useRef(props);
  useEffect(() => { callbacks.current = props; });
  useEffect(() => {
    let disposed = false;
    let saveActivity = false;
    let control: PreviewControl | undefined;
    const { version, mode } = props;
    async function start() {
      try {
        await callbacks.current.beforeStart?.();
        if (await sourceHash(version.artifact) !== version.sourceHash) throw new Error("版本源码校验失败，请重新载入项目。");
        if (disposed || !iframe.current) return;
        control = mountPreview(iframe.current, {
          artifact: version.artifact, mode, projectId: version.projectId, versionId: version.id,
          readData: async () => appDataSchema.parse(await apiJson(`/api/projects/${version.projectId}/data`)),
          writeData: input => apiJson(`/api/projects/${version.projectId}/data`, input, "PUT"),
          onReady: revision => {
            if (mode === "probe" || !saveActivity) callbacks.current.onResult?.(revision, []);
          },
          onDiagnostic: (diagnostic, revision) => {
            if (mode === "probe") callbacks.current.onResult?.(revision, [diagnostic]);
            else callbacks.current.onDiagnostic?.(diagnostic);
          },
          onPlatformError: error => callbacks.current.onError(error.message),
          onSaveStatus: (status, message) => { saveActivity = true; callbacks.current.onSaveStatus?.(status, message); },
        });
        if (callbacks.current.control) callbacks.current.control.current = control;
      } catch (e) { if (!disposed) callbacks.current.onError(e instanceof Error ? e.message : "预览暂不可用。"); }
    }
    void start();
    return () => { disposed = true; control?.destroy(); const target = callbacks.current.control; if (target && target.current === control) target.current = null; };
    // Callbacks are read from a ref; source identity alone controls sandbox lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.version.id, props.mode]);
  return <iframe ref={iframe} title={props.mode === "probe" ? "候选启动检查" : props.mode === "history" ? "历史版本预览（操作不保存）" : "应用预览"} sandbox="allow-scripts" referrerPolicy="no-referrer" className="app-frame" />;
}
