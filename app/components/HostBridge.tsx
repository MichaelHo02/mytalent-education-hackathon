"use client";

import { useEffect } from "react";
import { adminPrompt, uploadPrompt, briefPrompt, finishPrompt, canSendHostPrompt, initializeHostBridge, isMcpApp, markingPrompt, sendHostPrompt } from "@/lib/host-bridge";

export default function HostBridge() {
  useEffect(() => {
    if (!isMcpApp()) return;
    const grade = (event: Event) => {
      const detail = (event as CustomEvent<{ submissionId?: string }>).detail;
      if (!detail?.submissionId || !canSendHostPrompt()) return;
      event.preventDefault();
      void sendHostPrompt(markingPrompt(detail.submissionId), "grade").catch(() => undefined);
    };
    const brief = (event: Event) => {
      const detail = (event as CustomEvent<{ submissionId?: string; audience?: string; date?: string }>).detail;
      if ((!detail?.submissionId && detail?.audience !== 'manager') || !["student", "parent", "manager"].includes(detail?.audience ?? "") || !canSendHostPrompt()) return;
      event.preventDefault();
      void sendHostPrompt(briefPrompt(detail.submissionId, detail.audience as "student" | "parent" | "manager", detail.date), "brief").catch(() => undefined);
    };
    const upload = (event: Event) => {
      if (!canSendHostPrompt()) return;
      event.preventDefault();
      const detail = (event as CustomEvent<{ testId?: string }>).detail;
      void sendHostPrompt(uploadPrompt(detail?.testId), "upload").catch(() => undefined);
    };
    const admin = (event: Event) => {
      if (!canSendHostPrompt()) return;
      event.preventDefault();
      const detail = (event as CustomEvent<{ date?: string }>).detail;
      void sendHostPrompt(adminPrompt(detail?.date), "admin").catch(() => undefined);
    };
    const finish = (event: Event) => {
      const detail = (event as CustomEvent<{ submissionId?: string; date?: string }>).detail;
      if (!detail?.submissionId || !canSendHostPrompt()) return;
      event.preventDefault();
      void sendHostPrompt(finishPrompt(detail.submissionId, detail.date), "finish").catch(() => undefined);
    };
    window.addEventListener("tutor:grade", grade);
    window.addEventListener("tutor:brief", brief);
    window.addEventListener("tutor:upload", upload);
    window.addEventListener("tutor:admin", admin);
    window.addEventListener("tutor:finish", finish);
    void initializeHostBridge().catch(() => undefined);
    return () => {
      window.removeEventListener("tutor:grade", grade);
      window.removeEventListener("tutor:brief", brief);
      window.removeEventListener("tutor:upload", upload);
      window.removeEventListener("tutor:admin", admin);
      window.removeEventListener("tutor:finish", finish);
    };
  }, []);
  return null;
}
