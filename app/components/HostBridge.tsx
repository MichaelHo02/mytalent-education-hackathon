"use client";

import { useEffect } from "react";
import { adminPrompt, uploadPrompt, briefPrompt, canSendHostPrompt, initializeHostBridge, isMcpApp, markingPrompt, sendHostPrompt } from "@/lib/host-bridge";

export default function HostBridge() {
  useEffect(() => {
    if (!isMcpApp()) return;
    const grade = (event: Event) => {
      const detail = (event as CustomEvent<{ submissionId?: string }>).detail;
      if (!detail?.submissionId || !canSendHostPrompt()) return;
      event.preventDefault();
      void sendHostPrompt(markingPrompt(detail.submissionId)).catch(() => undefined);
    };
    const brief = (event: Event) => {
      const detail = (event as CustomEvent<{ submissionId?: string; audience?: string; date?: string }>).detail;
      if ((!detail?.submissionId && detail?.audience !== 'manager') || !["student", "parent", "manager"].includes(detail?.audience ?? "") || !canSendHostPrompt()) return;
      event.preventDefault();
      void sendHostPrompt(briefPrompt(detail.submissionId, detail.audience as "student" | "parent" | "manager", detail.date)).catch(() => undefined);
    };
    const upload=(event:Event)=>{if(!canSendHostPrompt())return;event.preventDefault();const d=(event as CustomEvent<{testId?:string}>).detail;void sendHostPrompt(uploadPrompt(d?.testId)).catch(()=>undefined);};
    const admin=(event:Event)=>{if(!canSendHostPrompt())return;event.preventDefault();const d=(event as CustomEvent<{date?:string}>).detail;void sendHostPrompt(adminPrompt(d?.date)).catch(()=>undefined);};
    window.addEventListener("tutor:grade", grade);
    window.addEventListener("tutor:brief", brief);
    window.addEventListener("tutor:upload", upload);
    window.addEventListener("tutor:admin", admin);
    void initializeHostBridge().catch(() => undefined);
    return () => {
      window.removeEventListener("tutor:grade", grade);
      window.removeEventListener("tutor:brief", brief);
      window.removeEventListener("tutor:upload", upload);
      window.removeEventListener("tutor:admin", admin);
    };
  }, []);
  return null;
}
