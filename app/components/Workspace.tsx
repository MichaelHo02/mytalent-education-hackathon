"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, Copy, Download, FileCheck2, FileImage, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { calendarDate, generateBriefs, generateExhibits, today } from "@/lib/domain";
import { adminPrompt, briefPrompt, downloadFile, finishPrompt, isMcpApp, markingPrompt, requestApi, uploadPrompt } from "@/lib/host-bridge";
import type { SavedBrief, Submission, SubmissionFile, Test, WorkspaceState } from "@/lib/types";

type View = "mark" | "daily" | "briefs";
type Audience = "student" | "parent" | "manager";
type ResponseData = { state: WorkspaceState; submission?: Submission; error?: string };
const emptyState: WorkspaceState = { tests: [], submissions: [], activities: [], followups: [] };
const statusLabels = { awaiting_marking: "Awaiting marking", draft: "Needs review", approved: "Approved" };
const resultLabels = { correct: "Correct", wrong: "Incorrect", careless: "Careless error", blank: "Not attempted", review: "Needs review" };
const activityLabels = { attendance: "Attendance", qa: "Student Q&A", parent_contact: "Parent contact", sac_support: "SAC support" };
const pluginLink = "codex://plugins/plugin_asdk_app_sites_6a8a554913148191a4ecd150b050413d/app/open_tutor_workspace";
function dateLabel(date: string) { return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`)); }
function json(method: string, body: unknown): RequestInit { return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }; }
async function api(path: string, init?: RequestInit): Promise<ResponseData> {
  const response = await requestApi(path, init);
  const data = await response.json() as ResponseData;
  if (!response.ok) throw new Error(data.error ?? "Could not complete this request.");
  return data;
}
function Field({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  return <Label className="field"><span>{label}</span>{children}{help && <span className="field-help">{help}</span>}</Label>;
}
function Section({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }) {
  return <Card><CardHeader><div className="section-heading"><CardTitle>{title}</CardTitle>{action}</div>{description && <CardDescription>{description}</CardDescription>}</CardHeader><CardContent>{children}</CardContent></Card>;
}
function Empty({ children }: { children: ReactNode }) { return <p className="empty-text">{children}</p>; }
function CodexIcon() {
  // Codex application icon, sourced from the installed OpenAI desktop app.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/codex-icon.png" alt="" width={20} height={20} className="codex-icon" />;
}
function AgentButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <Button type="button" onClick={onClick} disabled={disabled}>{children}</Button>;
}

export default function Workspace() {
  const [state, setState] = useState<WorkspaceState>(emptyState);
  const [view, setView] = useState<View>("mark");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [prompt, setPrompt] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [audience, setAudience] = useState<Audience>("student");
  const [briefId, setBriefId] = useState("");
  const [reportDate, setReportDate] = useState(today);
  const [pendingUntil, setPendingUntil] = useState(0);
  const [sending, setSending] = useState(false);
  const knownSubmissions = useRef<Set<string> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api("/api/workspace");
      const newSubmission = knownSubmissions.current && data.state.submissions.find(s => !knownSubmissions.current!.has(s.id));
      knownSubmissions.current = new Set(data.state.submissions.map(s => s.id));
      setState(data.state);
      setSelectedId(current => newSubmission?.id || (data.state.submissions.some(s => s.id === current) ? current : data.state.submissions[0]?.id || ""));
    }
    catch (err) { setError(err instanceof Error ? err.message : "Could not open your workspace."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    // Loading remote data updates React only after the awaited request completes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const update = () => { void refresh(); };
    const status = (event: Event) => {
      const detail = (event as CustomEvent<{ status: string; message?: string; prompt?: string }>).detail;
      if (detail.status === "working") setSending(true);
      if (detail.status === "sent" || detail.status === "error") setSending(false);
      if (detail.status === "error") setError(detail.message ?? "The conversation request failed.");
      else if (detail.message) setNotice(detail.message);
      if (detail.prompt) setPrompt(detail.prompt);
      if (detail.status === "sent") { setPendingUntil(Date.now() + 120000); void refresh(); }
    };
    window.addEventListener("focus", update);
    window.addEventListener("tutor:refresh", update);
    window.addEventListener("tutor:data-changed", update);
    window.addEventListener("tutor:host-status", status);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("tutor:refresh", update);
      window.removeEventListener("tutor:data-changed", update);
      window.removeEventListener("tutor:host-status", status);
    };
  }, [refresh]);
  useEffect(() => {
    if (!pendingUntil && !state.submissions.some(s => s.status === "awaiting_marking")) return;
    const interval = setInterval(() => {
      void refresh();
      if (pendingUntil && Date.now() >= pendingUntil) setPendingUntil(0);
    }, pendingUntil ? 5000 : 15000);
    return () => clearInterval(interval);
  }, [state.submissions, pendingUntil, refresh]);

  async function mutate(path: string, init: RequestInit, message: string) {
    setBusy(true); setError("");
    try { const data = await api(path, init); setState(data.state); setNotice(message); return data; }
    catch (err) { setError(err instanceof Error ? err.message : "Could not save the change."); throw err; }
    finally { setBusy(false); }
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setNotice("Copied."); }
    catch { setPrompt(text); setNotice("Select and copy the text below."); }
  }
  async function exportRecords(kind: string, date = reportDate) {
    setError("");
    try { await downloadFile(`/api/export?kind=${kind}&date=${date}`, `tutor-${kind}-${date}.csv`); setNotice("Spreadsheet export ready."); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not export the records."); }
  }
  function askCodex(submission: Submission, kind: "grade" | "brief", who?: Audience) {
    const prepared = kind === "grade" ? markingPrompt(submission.id) : briefPrompt(submission.id, who ?? "student");
    const handled = !window.dispatchEvent(new CustomEvent(`tutor:${kind}`, { cancelable: true, detail: { submissionId: submission.id, audience: who } }));
    if (handled) setPendingUntil(Date.now() + 120000);
    if (!handled) { setPrompt(prepared); setNotice("Copy this request into Codex. Attach the paper pages there if needed."); }
  }
  function askManagerBrief() {
    const handled = !window.dispatchEvent(new CustomEvent("tutor:brief", { cancelable: true, detail: { audience: "manager", date: reportDate } }));
    if (handled) setPendingUntil(Date.now() + 120000);
    if (!handled) { setPrompt(briefPrompt(undefined, "manager", reportDate)); setNotice("Copy this request into Codex to refine the manager summary."); }
  }
  function startWorkflow(kind: "upload" | "admin") {
    const detail = kind === "upload" ? {} : { date: reportDate };
    const handled = !window.dispatchEvent(new CustomEvent(`tutor:${kind}`, { cancelable: true, detail }));
    if (handled) setPendingUntil(Date.now() + 120000);
    else {
      setPrompt(kind === "upload" ? uploadPrompt() : adminPrompt(reportDate));
      setNotice("Open this plugin in Codex to run the workflow, or copy the request into your conversation.");
    }
  }
  function finishWorkflow(submissionId: string, date = reportDate) {
    const handled = !window.dispatchEvent(new CustomEvent("tutor:finish", { cancelable: true, detail: { submissionId, date } }));
    if (handled) setPendingUntil(Date.now() + 120000);
    else { setPrompt(finishPrompt(submissionId, date)); setNotice("Your records are ready. Continue in Codex to prepare the feedback."); }
  }
  const selected = state.submissions.find(s => s.id === selectedId);
  const approved = state.submissions.filter(s => s.status === "approved");
  const derived = generateBriefs(state, reportDate);
  const brief = derived.student.find(b => b.submissionId === briefId) ?? derived.student[0];
  const currentBriefSubmission = approved.find(s => s.id === brief?.submissionId);
  const savedBrief = state.briefs?.filter(b => b.audience === audience && (audience === "manager" ? b.date === reportDate : b.submissionId === brief?.submissionId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  return <div className="tutor-app">
    <a href="#main" className="skip-link">Skip to workspace</a>
    <header className="app-header"><div className="app-brand">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/mytalent-logo.png" alt="" width={42} height={34} className="brand-logo" />
      <div><h1>MyTalent Education</h1><p>Tutor workspace</p></div>
    </div><Button variant="ghost" size="icon" type="button" aria-label="Refresh workspace" onClick={() => { setError(""); void refresh(); }}><RefreshCw className={loading ? "animate-spin" : ""} /></Button></header>
    <main id="main">
      {!isMcpApp() && <p className="site-host-help">Public demo · For guided marking, open MyTalent Education in the Codex sidebar.</p>}
      {error && <Alert variant="destructive" className="status-alert" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      {notice && <Alert className="status-alert" role="status"><Check /><AlertDescription>{notice}</AlertDescription><Button variant="ghost" size="sm" className="dismiss-notice" type="button" onClick={() => setNotice("")}>Dismiss</Button></Alert>}
      {prompt && <Card className="prompt-card"><CardHeader><CardTitle>Continue in Codex</CardTitle><CardDescription>Use the MyTalent Education plugin in Codex, then attach your paper photos. This browser cannot start a Codex turn.</CardDescription></CardHeader><CardContent><Textarea aria-label="Prepared Codex request" value={prompt} readOnly rows={5} /><div className="actions"><Button type="button" onClick={() => void copy(prompt)}><Copy />Copy request</Button><Button asChild variant="outline"><a href={pluginLink}>Open in Codex<ArrowRight /></a></Button><Button variant="ghost" type="button" onClick={() => setPrompt("")}>Close</Button></div></CardContent></Card>}
      <Tabs value={view} onValueChange={value => { setView(value as View); setPrompt(""); }}>
        <TabsList className="main-tabs"><TabsTrigger value="mark">Student work</TabsTrigger><TabsTrigger value="briefs">Records & feedback</TabsTrigger><TabsTrigger value="daily">Daily log</TabsTrigger></TabsList>
        {loading ? <div className="loading" role="status"><LoaderCircle className="animate-spin" />Opening workspace…</div> : <>
          <TabsContent value="mark" className="tab-content">
            <div className="start-panel">
              <div className="start-icon"><FileImage size={22} /></div>
              <h2>From paper to progress.</h2>
              <p>Upload student work in Codex. Review the marks.<br />Your records and feedback follow.</p>
              <AgentButton onClick={() => startWorkflow("upload")} disabled={busy || sending}><CodexIcon />Mark student work with Codex<ArrowRight /></AgentButton>
              <span className="start-hint">Photos or PDF · Include a rubric if you have one</span>
            </div>
            {!state.submissions.length && <>
              <ol className="workflow-steps"><li><span>1</span><div><strong>Upload</strong><small>Codex guides you through the photos and rubric.</small></div></li><li><span>2</span><div><strong>Review</strong><small>Check suggested marks and any unclear answers.</small></div></li><li><span>3</span><div><strong>Ready</strong><small>Approve once. Get Exhibits 1–3 and feedback.</small></div></li></ol>
              <div className="work-empty"><FileCheck2 size={19} /><p>Your students’ work will appear here.</p></div>
            </>}
            {state.submissions.length > 0 && <div className="work-section">
              <div className="list-heading"><h2>Student work</h2><Badge variant="secondary">{state.submissions.length}</Badge></div>
              <div className="paper-list">{state.submissions.map(submission => <Button variant={selectedId === submission.id ? "secondary" : "ghost"} className="paper-list-button" key={submission.id} type="button" onClick={() => setSelectedId(submission.id)}><Avatar className="paper-avatar"><AvatarFallback>{submission.studentName.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</AvatarFallback></Avatar><span className="paper-info"><strong>{submission.studentName}</strong><small>{state.tests.find(test => test.id === submission.testId)?.title}</small></span><Badge variant="outline">{statusLabels[submission.status]}</Badge></Button>)}</div>
            </div>}
            {selected && <MarkingReview key={`${selected.id}-${selected.revision}`} submission={selected} test={state.tests.find(test => test.id === selected.testId)} busy={busy || sending} onAsk={() => askCodex(selected, "grade")} onApprove={async () => {
              const result = await mutate(`/api/submissions/${selected.id}/approve`, json("POST", { expectedRevision: selected.revision }), "Approved. Exhibits 1–3 are ready; Codex can now prepare your feedback.");
              const approvedAt = result?.state.submissions.find(s => s.id === selected.id)?.approvedAt;
              const date = approvedAt ? calendarDate(approvedAt) : today();
              setReportDate(date); setBriefId(selected.id); setView("briefs"); finishWorkflow(selected.id, date);
            }} onBrief={() => { setBriefId(selected.id); setView("briefs"); }} />}
          </TabsContent>
          <TabsContent value="daily" className="tab-content">
            <div className="daily-toolbar"><Field label="Reporting date"><Input type="date" name="reportDate" value={reportDate} onChange={e => setReportDate(e.target.value || today())} required /></Field><Button type="button" variant="outline" onClick={() => void exportRecords("daily")}><Download />Export daily report</Button></div>
            <Section title="Update your daily log" description="Tell Codex about today’s support, parent contacts and follow-ups.">
              <AgentButton onClick={() => startWorkflow("admin")} disabled={busy || sending}><CodexIcon />Update log with Codex</AgentButton>
            </Section>
            <div className="daily-summary"><span><strong>{derived.manager.papersMarked}</strong> papers approved</span><span><strong>{derived.manager.activities.qa}</strong> Q&A</span><span><strong>{derived.manager.activities.parent_contact}</strong> parent contacts</span><span><strong>{derived.manager.activities.sac_support}</strong> SAC support</span></div>
            <Section title="Recorded activity">{state.activities.some(activity => activity.date === reportDate) ? <Table><TableHeader><TableRow><TableHead>Activity</TableHead><TableHead>Student</TableHead><TableHead>Count</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader><TableBody>{state.activities.filter(activity => activity.date === reportDate).map(activity => <TableRow key={activity.id}><TableCell>{activityLabels[activity.type]}</TableCell><TableCell>{activity.studentName || "—"}</TableCell><TableCell>{activity.count}</TableCell><TableCell className="wrap-cell">{activity.notes || "—"}</TableCell></TableRow>)}</TableBody></Table> : <Empty>No activity recorded for this date.</Empty>}</Section>
            {state.followups.length > 0 && <Section title="Follow-ups"><div className="followup-list">{state.followups.map(followup => <Label key={followup.id} className="followup-row"><Input type="checkbox" name={`followup-${followup.id}`} checked={followup.done} disabled={busy} onChange={e => { void mutate(`/api/followups/${followup.id}`, json("PATCH", { done: e.target.checked }), "Follow-up updated.").catch(() => {}); }} /><span className={followup.done ? "completed" : ""}>{followup.task}<small>{followup.studentName} · Due {dateLabel(followup.dueDate)}</small></span></Label>)}</div></Section>}
          </TabsContent>
          <TabsContent value="briefs" className="tab-content">
            <ExhibitRecords state={state} onExport={exportRecords} />
            <Section title="Feedback & talking points" description="Student, parent and manager drafts from approved evidence.">
              <div className="brief-controls"><Field label="Audience"><NativeSelect name="audience" value={audience} onChange={e => setAudience(e.target.value as Audience)}><option value="student">Student</option><option value="parent">Parent</option><option value="manager">Manager</option></NativeSelect></Field>{audience === "manager" ? <Field label="Reporting date"><Input type="date" name="briefDate" value={reportDate} onChange={e => setReportDate(e.target.value || today())} required /></Field> : <Field label="Approved result"><NativeSelect name="approvedResult" value={brief?.submissionId ?? ""} onChange={e => setBriefId(e.target.value)}>{!brief && <option value="">No approved results</option>}{derived.student.map(item => <option key={item.submissionId} value={item.submissionId}>{item.studentName} · {item.testTitle}</option>)}</NativeSelect></Field>}</div>
              <div className="actions"><AgentButton disabled={busy || sending || (audience !== "manager" && !currentBriefSubmission)} onClick={() => { if (audience === "manager") askManagerBrief(); else if (currentBriefSubmission) askCodex(currentBriefSubmission, "brief", audience); }}><CodexIcon />Generate this brief</AgentButton>{currentBriefSubmission && <Button type="button" variant="outline" disabled={busy || sending} onClick={() => finishWorkflow(currentBriefSubmission.id)}>Prepare all feedback</Button>}</div>
            </Section>
            {savedBrief ? <SavedBriefCard brief={savedBrief} state={state} onCopy={copy} /> : <Section title="Your conversation brief"><Empty>{audience === "manager" ? "Generate a manager brief from the work in your daily log." : brief ? "Choose a student and generate a brief with Codex." : "Approve a paper first, then choose a student and generate a brief."}</Empty></Section>}
            {(audience === "manager" || brief) && <details className="approved-sources"><summary>Approved evidence</summary><div className="manual-content">{audience === "manager" ? <ManagerEvidence state={state} date={reportDate} /> : brief && <Section title="Source results" description={`${brief.studentName} · ${brief.testTitle} · ${brief.score}/${brief.maxScore}`}><BriefList title="Criteria fully met" items={brief.strengths} empty="No fully met criteria recorded." /><BriefList title="Recorded next steps" items={brief.nextSteps} empty="No specific practice needs recorded." /><details className="evidence-details"><summary>Question evidence</summary><ul>{brief.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul></details></Section>}</div></details>}
            <p className="help-text">Review generated feedback before using it. Every performance statement should trace back to approved evidence. Nothing is sent to anyone.</p>
          </TabsContent>
        </>}
      </Tabs>
    </main>
    <footer className="app-footer"><span>Suggested by Codex. Approved by you.</span><span>Hackathon demo</span></footer>
  </div>;
}

function MarkingReview({ submission, test, busy, onAsk, onApprove, onBrief }: { submission: Submission; test?: Test; busy: boolean; onAsk: () => void; onApprove: () => Promise<void>; onBrief: () => void }) {
  const marks = submission.questions;
  const [activeFile, setActiveFile] = useState(0);
  const approved = submission.status === "approved";
  const unresolved = marks.some(q => q.status === "review" || q.awardedMarks === null || (q.status !== "blank" && (!q.evidence.trim() || !q.reason.trim())));
  const score = marks.reduce((n, q) => n + (q.awardedMarks ?? 0), 0);
  const maxScore = test?.questions.reduce((n, q) => n + q.maxMarks, 0) ?? 0;
  return <Section title="Review & approve" description={`${submission.studentName} · ${test?.title ?? "Test"}`} action={<Badge variant={approved ? "secondary" : "outline"}>{statusLabels[submission.status]}</Badge>}>
    <div className="review-toolbar"><strong>{score} / {maxScore} marks</strong>{!approved && <AgentButton onClick={onAsk} disabled={busy}><CodexIcon />{submission.status === "awaiting_marking" ? "Mark with Codex" : "Revise with Codex"}</AgentButton>}</div>
    <details className="paper-details"><summary>{submission.inputSource === "chat" ? "Original photos are in Codex" : "View paper & marking guide"}</summary>{submission.files.length ? <><div className="actions">{submission.files.map((f, i) => <Button type="button" size="sm" variant={activeFile === i ? "secondary" : "outline"} key={f.id} onClick={() => setActiveFile(i)}>Page {i + 1}</Button>)}</div><ProtectedFile key={submission.files[activeFile]?.id ?? submission.files[0].id} file={submission.files[activeFile] ?? submission.files[0]} /></> : <p className="help-text">{submission.inputSource === "chat" ? `Review the original pages in your conversation: ${submission.chatAttachmentNames?.join(", ")}. The workspace records the marking evidence; the photos stay in chat.` : "No paper pages are stored with this record."}</p>}<details className="evidence-details"><summary>Saved marking guide</summary><pre>{test?.guideText}</pre></details></details>
    <div>
      <div className="question-reviews">{marks.map((mark) => { const q = test?.questions.find(q => q.id === mark.questionId); return <div className={`question-review ${mark.status === "review" ? "needs-review" : ""}`} key={mark.questionId}>
        <div className="question-heading"><div><strong>{mark.questionId}</strong><span>{q?.topic}</span></div><div className="mark-score"><strong>{mark.awardedMarks ?? "—"}</strong><span>/ {q?.maxMarks}</span></div></div>
        <div className="question-result"><Badge variant="outline">{resultLabels[mark.status]}</Badge></div>
        <p className="question-reason">{mark.reason || "Waiting for Codex to read the student’s work."}</p>
        {mark.evidence && <p className="question-evidence">{mark.evidence}</p>}
        <details className="question-edit"><summary>Marking criteria & notes</summary><p className="criterion">{q?.criteria}</p>{mark.tutorNote && <p className="question-evidence">Tutor note: {mark.tutorNote}</p>}</details>
      </div>; })}</div>
      <div className="actions">{approved ? <Button type="button" onClick={onBrief}>View records & feedback<ArrowRight /></Button> : <Button type="button" disabled={busy || unresolved || submission.status === "awaiting_marking"} onClick={() => { void onApprove().catch(() => {}); }}><Check />Approve & prepare records</Button>}</div><p className="help-text">{approved ? "Approved results are locked and included in exports." : unresolved ? "Ask Codex to resolve flagged answers before approving." : "Check each mark and its evidence. Ask Codex for corrections, or approve."}</p>
    </div>
  </Section>;
}

function ProtectedFile({ file }: { file: SubmissionFile }) {
  const [url, setUrl] = useState(""); const [error, setError] = useState("");
  useEffect(() => {
    let objectUrl = ""; let cancelled = false;
    void requestApi(`/api/files/${file.id}`).then(async response => { if (!response.ok) throw new Error("Could not open this page."); objectUrl = URL.createObjectURL(await response.blob()); if (!cancelled) setUrl(objectUrl); }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the page."); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file.id]);
  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!url) return <p className="help-text" role="status">Opening paper…</p>;
  // Uploaded paper blobs must render directly inside the embedded app.
  // eslint-disable-next-line @next/next/no-img-element
  return <div className="paper-preview">{file.mimeType === "application/pdf" ? <object data={url} type="application/pdf" aria-label={file.name}><Button type="button" variant="outline" onClick={() => void downloadFile(`/api/files/${file.id}`, file.name)}>Download PDF</Button></object> : <img src={url} alt={`Student paper: ${file.name}`} />}</div>;
}

function ExhibitRecords({ state, onExport }: { state: WorkspaceState; onExport: (kind: string) => Promise<void> }) {
  const exhibits = generateExhibits(state);
  const available = exhibits.exams.length > 0;
  const items = [
    { kind: "marking", title: "Marking sheet", detail: "Question results, syllabus points and evidence", count: exhibits.marking.length },
    { kind: "progress", title: "Student progress", detail: "Topic evidence · mastery awaits tutor confirmation", count: exhibits.progress.length },
    { kind: "exams", title: "Exam statistics", detail: "Scores and attempts recorded in this workspace", count: exhibits.exams.length },
  ];
  return <Section title="Your admin records" description={available ? "Updated together from approved marking. No re-entry needed." : "Approve student work to populate all three Exhibits."}>
    <div className="exhibit-list">{items.map((item, index) => <div className="exhibit-row" key={item.kind}><span className="exhibit-number">{index + 1}</span><div><span className="eyebrow">EXHIBIT {index + 1}</span><h3>{item.title}</h3><p>{item.detail}</p></div><Button variant="ghost" size="icon" type="button" disabled={!available} aria-label={`Download Exhibit ${index + 1} CSV`} onClick={() => void onExport(item.kind)}><Download /></Button></div>)}</div>
    {available && <details className="exhibit-preview"><summary>Preview approved records</summary>
      <h3>Exhibit 1 · Marking</h3><div className="exhibit-preview-list">{exhibits.marking.map(row => <div key={`${row.submissionId}:${row.questionId}`}><span>{row.studentName} · {row.questionId}<small>{row.topic}</small></span><Badge variant="outline">{row.outcome} · {row.marks}/{row.maxMarks}</Badge></div>)}</div>
      <h3>Exhibit 2 · Progress evidence</h3><p className="help-text">{exhibits.scope.progress}</p><div className="exhibit-preview-list">{exhibits.progress.map(row => <div key={`${row.studentName}:${row.topic}`}><span>{row.studentName} · {row.topic}<small>{row.mastery}</small></span><span>{row.percentage === null ? row.evidenceStatus : `${row.marks}/${row.maxMarks}`}</span></div>)}</div>
      <h3>Exhibit 3 · Exam statistics</h3><p className="help-text">{exhibits.scope.exams}</p><div className="exhibit-preview-list">{exhibits.exams.map(row => <div key={row.submissionId}><span>{row.studentName}<small>{row.testTitle} · Recorded attempt {row.recordedAttempt}</small></span><strong>{row.percentage}%</strong></div>)}</div>
    </details>}
  </Section>;
}

function BriefList({ title, items, empty }: { title: string; items: string[]; empty?: string }) { return <div className="brief-section"><h3>{title}</h3>{items.length ? <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="help-text">{empty}</p>}</div>; }
function ManagerEvidence({ state, date }: { state: WorkspaceState; date: string }) {
  const brief = generateBriefs(state, date).manager;
  const activities = state.activities.filter(activity => activity.date === date);
  return <Section title="Recorded sources" description={dateLabel(date)}><BriefList title="Recorded work & follow-ups" items={brief.talkingPoints} /><details className="evidence-details"><summary>Activity notes</summary>{activities.length ? <ul>{activities.map(activity => <li key={activity.id}>{activityLabels[activity.type]} · {activity.studentName || "Activity"} · {activity.notes || "No note recorded."}</li>)}</ul> : <p className="help-text">No activity recorded for this date.</p>}</details></Section>;
}

function SavedBriefCard({ brief, state, onCopy }: { brief: SavedBrief; state: WorkspaceState; onCopy: (text: string) => Promise<void> }) {
  return <Section title="Codex draft" description={`${brief.audience[0].toUpperCase() + brief.audience.slice(1)} brief · ${dateLabel(brief.date)}`} action={<Button type="button" size="sm" variant="outline" onClick={() => void onCopy(brief.text)}><Copy />Copy</Button>}>
    <div className="saved-brief-text">{brief.text}</div>
    <details className="evidence-details"><summary>Sources used · {brief.evidenceRefs.length} references</summary><ul>{brief.evidenceRefs.map(reference => {
      const submission = state.submissions.find(item => item.id === reference || reference.startsWith(`${item.id}:`));
      const question = submission?.questions.find(item => `${submission.id}:${item.questionId}` === reference);
      const activity = state.activities.find(item => item.id === reference);
      return <li key={reference}>{submission ? <><strong>{submission.studentName}{question ? ` · ${question.questionId}` : " · Approved result"}</strong>{question && <p>{question.evidence} {question.reason}</p>}</> : activity ? <><strong>{activityLabels[activity.type]} · {activity.date}</strong><p>{activity.studentName} · Count {activity.count} · {activity.notes}</p></> : <span>Saved source</span>}<code className="source-reference">{reference}</code></li>;
    })}</ul><h3 className="source-revisions-title">Approved record versions</h3><ul>{Object.entries(brief.sourceRevisions).map(([id, revision]) => <li key={id}>{state.submissions.find(item => item.id === id)?.studentName ?? "Submission"} · revision {revision}<code className="source-reference">{id}</code></li>)}</ul></details>
    <p className="help-text">Generated draft for tutor review. Sources and their saved versions are listed above.</p>
  </Section>;
}
