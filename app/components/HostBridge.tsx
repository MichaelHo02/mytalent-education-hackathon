"use client";

import { useEffect } from "react";
import { briefPrompt, canSendHostPrompt, initializeHostBridge, isMcpApp, markingPrompt, sendHostPrompt } from "@/lib/host-bridge";

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
    window.addEventListener("tutor:grade", grade);
    window.addEventListener("tutor:brief", brief);
    void initializeHostBridge().catch(() => undefined);
    return () => {
      window.removeEventListener("tutor:grade", grade);
      window.removeEventListener("tutor:brief", brief);
    };
  }, []);
  return null;
}
