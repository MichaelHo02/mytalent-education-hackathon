"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Check, Copy, Download, LoaderCircle, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { generateBriefs, today } from "@/lib/domain";
import { adminPrompt, briefPrompt, downloadFile, isMcpApp, markingPrompt, requestApi, uploadPrompt } from "@/lib/host-bridge";
import type { Question, QuestionMark, SavedBrief, Submission, SubmissionFile, Test, WorkspaceState } from "@/lib/types";

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
function AgentButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return isMcpApp() ? <Button type="button" onClick={onClick} disabled={disabled}>{children}</Button> : <Button asChild><a href={pluginLink}>{children}</a></Button>;
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
  const [guideOpen, setGuideOpen] = useState(false);
  const [audience, setAudience] = useState<Audience>("student");
  const [briefId, setBriefId] = useState("");
  const [reportDate, setReportDate] = useState(today);
  const [uploadTestId, setUploadTestId] = useState("");
  const [pendingUntil, setPendingUntil] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const data = await api("/api/workspace");
      setState(data.state);
      setSelectedId(current => current || data.state.submissions[0]?.id || "");
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
    const detail = kind === "upload" ? { testId: uploadTestId || undefined } : { date: reportDate };
    const handled = !window.dispatchEvent(new CustomEvent(`tutor:${kind}`, { cancelable: true, detail }));
    if (handled) setPendingUntil(Date.now() + 120000);
    else {
      setPrompt(kind === "upload" ? uploadPrompt(uploadTestId || undefined) : adminPrompt(reportDate));
      setNotice("Open this plugin in Codex to run the workflow, or copy the request into your conversation.");
    }
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
      {/* The supplied logo also embeds directly in the sidebar app bundle. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/mytalent-logo.png" alt="MyTalent Education logo" width={88} height={70} className="brand-logo" />
      <div><h1>MyTalent Education</h1><p>Mark paper tests. Update records. Prepare conversations.</p></div>
    </div><div className="header-actions"><Badge variant="secondary">Prototype</Badge><Button variant="ghost" size="icon" type="button" aria-label="Refresh workspace" onClick={() => { setError(""); void refresh(); }}><RefreshCw className={loading ? "animate-spin" : ""} /></Button></div></header>
    <main id="main">
      {!isMcpApp() && <p className="site-host-help">Open the sidebar plugin to run Codex actions. Manual records stay in this browser.</p>}
      {error && <Alert variant="destructive" className="status-alert" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      {notice && <Alert className="status-alert" role="status"><Check /><AlertDescription>{notice}</AlertDescription><Button variant="ghost" size="sm" className="dismiss-notice" type="button" onClick={() => setNotice("")}>Dismiss</Button></Alert>}
      {prompt && <Card className="prompt-card"><CardHeader><CardTitle>Continue in Codex</CardTitle><CardDescription>Copy the request into your conversation. Attach this student&apos;s paper pages if needed.</CardDescription></CardHeader><CardContent><Textarea aria-label="Prepared Codex request" value={prompt} readOnly rows={5} /><div className="actions"><Button type="button" onClick={() => void copy(prompt)}><Copy />Copy request</Button><Button variant="ghost" type="button" onClick={() => setPrompt("")}>Close</Button></div></CardContent></Card>}
      <Tabs value={view} onValueChange={value => { setView(value as View); setPrompt(""); }}>
        <TabsList className="main-tabs"><TabsTrigger value="mark">Mark paper</TabsTrigger><TabsTrigger value="daily">Daily log</TabsTrigger><TabsTrigger value="briefs">Conversation briefs</TabsTrigger></TabsList>
        {loading ? <div className="loading" role="status"><LoaderCircle className="animate-spin" />Opening workspace…</div> : <>
          <TabsContent value="mark" className="tab-content">
            <Section title="Start with your paper" description="Use the Codex conversation to upload pages, apply the marking guide and save a draft here.">
              <div className="agent-workflow">
                {state.tests.length > 0 && <Field label="Marking guide (optional)"><NativeSelect name="uploadTestId" value={uploadTestId} onChange={e => setUploadTestId(e.target.value)}><option value="">Let Codex choose or set up a test</option>{state.tests.map(test => <option key={test.id} value={test.id}>{test.title}</option>)}</NativeSelect></Field>}
                <AgentButton onClick={() => startWorkflow("upload")} disabled={busy}><Sparkles />Upload and mark with Codex</AgentButton>
              </div>
              <p className="help-text">{state.tests.length ? "Attach the student’s paper in chat. Codex will guide the setup and return suggested marks for your approval." : "Codex will ask for the question paper, supplied marking guide and student photos, then help set up the test."}</p>
              <details className="manual-entry"><summary>Manual entry</summary><div className="manual-content"><Button type="button" variant="outline" size="sm" onClick={() => setGuideOpen(true)}><Plus />New test & guide</Button>{state.tests.length ? <PaperForm tests={state.tests} busy={busy} onSubmit={async (form, chat) => {
                const data = await mutate(chat ? "/api/chat-submissions" : "/api/submissions", chat ? json("POST", { testId: form.get("testId"), studentName: form.get("studentName"), date: form.get("date"), chatAttachmentNames: String(form.get("chatAttachmentNames") ?? "").split(/\n/).map(name => name.trim()).filter(Boolean) }) : { method: "POST", body: form }, "Paper added. Ask Codex to prepare the draft marks.");
                if (data.submission) setSelectedId(data.submission.id);
              }} /> : <Empty>Save a test and marking guide before adding a paper manually.</Empty>}</div></details>
            </Section>
            <div className="mark-layout">
              <Section title="Saved papers">
                {state.submissions.length ? <div className="paper-list">{state.submissions.map(submission => <Button variant={selectedId === submission.id ? "secondary" : "ghost"} className="paper-list-button" key={submission.id} type="button" onClick={() => setSelectedId(submission.id)}><Avatar className="paper-avatar"><AvatarFallback>{submission.studentName.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</AvatarFallback></Avatar><span className="paper-info"><strong>{submission.studentName}</strong><small>{state.tests.find(test => test.id === submission.testId)?.title}</small><small>{submission.inputSource === "chat" ? "Photos in Codex" : submission.files.length ? "Stored paper" : "Paper record"} · {dateLabel(submission.date)}</small></span><Badge variant="outline">{statusLabels[submission.status]}</Badge></Button>)}</div> : <Empty>The drafts Codex saves will appear here for review.</Empty>}
              </Section>
              <div className="stack">
                {selected ? <MarkingReview key={`${selected.id}-${selected.revision}`} submission={selected} test={state.tests.find(test => test.id === selected.testId)} busy={busy} onAsk={() => askCodex(selected, "grade")} onSave={async questions => { await mutate(`/api/submissions/${selected.id}`, json("PATCH", { questions, expectedRevision: selected.revision }), "Draft marks saved."); }} onApprove={async () => { await mutate(`/api/submissions/${selected.id}/approve`, json("POST", { expectedRevision: selected.revision }), "Results approved. Exports and conversation briefs are ready."); }} onBrief={() => { setBriefId(selected.id); setView("briefs"); }} /> : <Section title="Review & approve" description="Codex drafts the marks. You make the final decision."><Empty>Upload and mark with Codex, then review the saved draft here.</Empty></Section>}
                <Section title="Export admin records" description="Only approved marks appear in exports."><ExportForm onExport={exportRecords} /></Section>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="daily" className="tab-content">
            <div className="daily-toolbar"><Field label="Reporting date"><Input type="date" name="reportDate" value={reportDate} onChange={e => setReportDate(e.target.value || today())} required /></Field><Button type="button" variant="outline" onClick={() => void exportRecords("daily")}><Download />Export daily report</Button></div>
            <Section title="Update your daily log" description="Tell Codex about today’s support, parent contacts and follow-ups.">
              <AgentButton onClick={() => startWorkflow("admin")} disabled={busy}><Sparkles />Update log with Codex</AgentButton>
              <details className="manual-entry"><summary>Manual entry</summary><div className="daily-layout manual-content"><Section title="Record an activity"><ActivityForm busy={busy} date={reportDate} onSubmit={async body => { await mutate("/api/activities", json("POST", body), "Activity saved."); }} /></Section><Section title="Add a follow-up"><FollowupForm busy={busy} date={reportDate} onSubmit={async body => { await mutate("/api/followups", json("POST", body), "Follow-up saved."); }} /></Section></div></details>
            </Section>
            <div className="daily-summary"><span><strong>{derived.manager.papersMarked}</strong> papers approved</span><span><strong>{derived.manager.activities.qa}</strong> Q&A</span><span><strong>{derived.manager.activities.parent_contact}</strong> parent contacts</span><span><strong>{derived.manager.activities.sac_support}</strong> SAC support</span></div>
            <Section title="Recorded activity">{state.activities.some(activity => activity.date === reportDate) ? <Table><TableHeader><TableRow><TableHead>Activity</TableHead><TableHead>Student</TableHead><TableHead>Count</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader><TableBody>{state.activities.filter(activity => activity.date === reportDate).map(activity => <TableRow key={activity.id}><TableCell>{activityLabels[activity.type]}</TableCell><TableCell>{activity.studentName || "—"}</TableCell><TableCell>{activity.count}</TableCell><TableCell className="wrap-cell">{activity.notes || "—"}</TableCell></TableRow>)}</TableBody></Table> : <Empty>No activity recorded for this date.</Empty>}</Section>
            {state.followups.length > 0 && <Section title="Follow-ups"><div className="followup-list">{state.followups.map(followup => <Label key={followup.id} className="followup-row"><Input type="checkbox" name={`followup-${followup.id}`} checked={followup.done} disabled={busy} onChange={e => { void mutate(`/api/followups/${followup.id}`, json("PATCH", { done: e.target.checked }), "Follow-up updated.").catch(() => {}); }} /><span className={followup.done ? "completed" : ""}>{followup.task}<small>{followup.studentName} · Due {dateLabel(followup.dueDate)}</small></span></Label>)}</div></Section>}
          </TabsContent>
          <TabsContent value="briefs" className="tab-content">
            <Section title="Generate a conversation brief" description="Codex uses approved marks and recorded activity to prepare a draft for your review.">
              <div className="brief-controls"><Field label="Audience"><NativeSelect name="audience" value={audience} onChange={e => setAudience(e.target.value as Audience)}><option value="student">Student</option><option value="parent">Parent</option><option value="manager">Manager</option></NativeSelect></Field>{audience === "manager" ? <Field label="Reporting date"><Input type="date" name="briefDate" value={reportDate} onChange={e => setReportDate(e.target.value || today())} required /></Field> : <Field label="Approved result"><NativeSelect name="approvedResult" value={brief?.submissionId ?? ""} onChange={e => setBriefId(e.target.value)}>{!brief && <option value="">No approved results</option>}{derived.student.map(item => <option key={item.submissionId} value={item.submissionId}>{item.studentName} · {item.testTitle}</option>)}</NativeSelect></Field>}</div>
              <div className="actions"><AgentButton disabled={busy || (audience !== "manager" && !currentBriefSubmission)} onClick={() => { if (audience === "manager") askManagerBrief(); else if (currentBriefSubmission) askCodex(currentBriefSubmission, "brief", audience); }}><Sparkles />Generate brief with Codex</AgentButton></div>
            </Section>
            {savedBrief ? <SavedBriefCard brief={savedBrief} state={state} onCopy={copy} /> : <Section title="Your conversation brief"><Empty>{audience === "manager" ? "Generate a manager brief from the work in your daily log." : brief ? "Choose a student and generate a brief with Codex." : "Approve a paper first, then choose a student and generate a brief."}</Empty></Section>}
            {(audience === "manager" || brief) && <details className="approved-sources"><summary>Approved evidence</summary><div className="manual-content">{audience === "manager" ? <ManagerEvidence state={state} date={reportDate} /> : brief && <Section title="Source results" description={`${brief.studentName} · ${brief.testTitle} · ${brief.score}/${brief.maxScore}`}><BriefList title="Criteria fully met" items={brief.strengths} empty="No fully met criteria recorded." /><BriefList title="Recorded next steps" items={brief.nextSteps} empty="No specific practice needs recorded." /><details className="evidence-details"><summary>Question evidence</summary><ul>{brief.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul></details></Section>}</div></details>}
            <p className="help-text">Review generated feedback before using it. Every performance statement should trace back to approved evidence. Nothing is sent to anyone.</p>
          </TabsContent>
        </>}
      </Tabs>
      <Dialog open={guideOpen} onOpenChange={setGuideOpen}><DialogContent className="test-dialog"><DialogHeader><DialogTitle>New test & marking guide</DialogTitle><DialogDescription>Save the supplied worked solutions and rules once.</DialogDescription></DialogHeader><TestForm busy={busy} onSubmit={async body => { await mutate("/api/tests", json("POST", body), "Test and guide saved."); setGuideOpen(false); }} /></DialogContent></Dialog>
    </main>
    <footer className="app-footer"><span>Draft marking always needs tutor approval.</span></footer>
  </div>;
}

function TestForm({ busy, onSubmit }: { busy: boolean; onSubmit: (body: { title: string; guideText: string; questions: Question[] }) => Promise<void> }) {
  const [questions, setQuestions] = useState<Question[]>([{ id: "Q1", topic: "", maxMarks: 1, criteria: "" }]);
  const [error, setError] = useState("");
  function change(index: number, patch: Partial<Question>) { setQuestions(qs => qs.map((q, i) => i === index ? { ...q, ...patch } : q)); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); const form = new FormData(event.currentTarget);
    if (new Set(questions.map(q => q.id.trim())).size !== questions.length) { setError("Question IDs must be unique."); return; }
    try { await onSubmit({ title: String(form.get("title")), guideText: String(form.get("guideText")), questions }); } catch (err) { setError(err instanceof Error ? err.message : "Could not save the test."); }
  }
  return <form action="/api/tests" method="post" onSubmit={submit} className="form-stack"><Field label="Test title (required)"><Input name="title" required maxLength={200} placeholder="Module 3 — Differentiation" /></Field><Field label="Worked solutions & marking rules (required)"><Textarea name="guideText" rows={4} required placeholder="Paste the supplied guide, including partial-credit rules." /></Field><fieldset className="rubric-fieldset"><legend>Question rubric</legend>{questions.map((q, index) => <div className="rubric-question" key={index}><div className="rubric-line"><Field label="Question ID"><Input name={`question-${index}`} value={q.id} required onChange={e => change(index, { id: e.target.value })} /></Field><Field label="Max marks"><Input name={`maximum-${index}`} type="number" min={1} max={100} step={1} value={q.maxMarks} required onChange={e => change(index, { maxMarks: Number(e.target.value) })} /></Field><Button variant="ghost" size="icon" type="button" aria-label={`Remove ${q.id}`} disabled={questions.length === 1} onClick={() => setQuestions(qs => qs.filter((_, i) => i !== index))}><Trash2 /></Button></div><Field label="Topic"><Input name={`topic-${index}`} value={q.topic} required onChange={e => change(index, { topic: e.target.value })} /></Field><Field label="Criterion & mark allocation"><Textarea name={`criterion-${index}`} rows={2} value={q.criteria} required onChange={e => change(index, { criteria: e.target.value })} placeholder="1 mark for the correct method; 1 mark for the final answer." /></Field></div>)}<Button type="button" variant="outline" size="sm" onClick={() => setQuestions(qs => [...qs, { id: `Q${qs.length + 1}`, topic: "", maxMarks: 1, criteria: "" }])}><Plus />Add question</Button></fieldset>{error && <p className="form-error" role="alert">{error}</p>}<Button type="submit" disabled={busy}>{busy && <LoaderCircle className="animate-spin" />}Save test & guide</Button></form>;
}

function PaperForm({ tests, busy, onSubmit }: { tests: Test[]; busy: boolean; onSubmit: (data: FormData, chat: boolean) => Promise<void> }) {
  const [source, setSource] = useState("chat");
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); try { await onSubmit(new FormData(event.currentTarget), source === "chat"); } catch { /* Workspace displays the server error. */ } }
  return <form action={source === "chat" ? "/api/chat-submissions" : "/api/submissions"} method="post" encType="multipart/form-data" onSubmit={submit} className="form-stack"><Field label="Test"><NativeSelect name="testId" required>{tests.map(test => <option key={test.id} value={test.id}>{test.title}</option>)}</NativeSelect></Field><Field label="Student label"><Input name="studentName" required maxLength={100} placeholder="Student A" /></Field><Field label="Test date"><Input name="date" type="date" defaultValue={today()} required /></Field><Field label="Paper photos"><NativeSelect name="inputSource" value={source} onChange={e => setSource(e.target.value)}><option value="chat">Already attached in Codex</option><option value="workspace">Upload here</option></NativeSelect></Field>{source === "chat" ? <Field label="Attached filenames" help="One per line. Attach these pages in your Codex conversation first; the photos stay in chat."><Textarea name="chatAttachmentNames" rows={2} required placeholder={"student-a-page-1.jpg\nstudent-a-page-2.jpg"} /></Field> : <Field label="Photos or PDF" help="Clear photos of every page, in order. JPEG, PNG, WebP or PDF. Up to 20 files; 20 MB total on the website, 8 MB in the sidebar."><Input type="file" name="files" accept="image/jpeg,image/png,image/webp,application/pdf" multiple required /></Field>}<Button type="submit" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <Plus />}{source === "chat" ? "Add chat paper" : "Upload paper"}</Button></form>;
}

function MarkingReview({ submission, test, busy, onAsk, onSave, onApprove, onBrief }: { submission: Submission; test?: Test; busy: boolean; onAsk: () => void; onSave: (questions: QuestionMark[]) => Promise<void>; onApprove: () => Promise<void>; onBrief: () => void }) {
  const [marks, setMarks] = useState(submission.questions);
  const [activeFile, setActiveFile] = useState(0);
  const dirty = JSON.stringify(marks) !== JSON.stringify(submission.questions);
  const approved = submission.status === "approved";
  const unresolved = marks.some(q => q.status === "review" || q.awardedMarks === null || (q.status !== "blank" && (!q.evidence.trim() || !q.reason.trim())));
  const score = marks.reduce((n, q) => n + (q.awardedMarks ?? 0), 0);
  const maxScore = test?.questions.reduce((n, q) => n + q.maxMarks, 0) ?? 0;
  function change(index: number, patch: Partial<QuestionMark>) { setMarks(qs => qs.map((q, i) => i === index ? { ...q, ...patch } : q)); }
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); try { await onSave(marks); } catch { /* Workspace displays the server error. */ } }
  return <Section title="Review & approve" description={`${submission.studentName} · ${test?.title ?? "Test"}`} action={<Badge variant={approved ? "secondary" : "outline"}>{statusLabels[submission.status]}</Badge>}>
    <div className="review-toolbar"><strong>{score} / {maxScore} marks</strong>{!approved && <AgentButton onClick={onAsk} disabled={busy}><Sparkles />{submission.status === "awaiting_marking" ? "Mark with Codex" : "Continue marking"}</AgentButton>}</div>
    <details className="paper-details"><summary>{submission.inputSource === "chat" ? "Original photos are in Codex" : "View paper & marking guide"}</summary>{submission.files.length ? <><div className="actions">{submission.files.map((f, i) => <Button type="button" size="sm" variant={activeFile === i ? "secondary" : "outline"} key={f.id} onClick={() => setActiveFile(i)}>Page {i + 1}</Button>)}</div><ProtectedFile key={submission.files[activeFile]?.id ?? submission.files[0].id} file={submission.files[activeFile] ?? submission.files[0]} /></> : <p className="help-text">{submission.inputSource === "chat" ? `Review the original pages in your conversation: ${submission.chatAttachmentNames?.join(", ")}. The workspace records the marking evidence; the photos stay in chat.` : "No paper pages are stored with this record."}</p>}<details className="evidence-details"><summary>Saved marking guide</summary><pre>{test?.guideText}</pre></details></details>
    <form action={`/api/submissions/${submission.id}`} method="post" onSubmit={save}>
      <Table className="mark-table"><TableHeader><TableRow><TableHead>Question</TableHead><TableHead>Marks</TableHead><TableHead>Result</TableHead><TableHead>Reason & evidence</TableHead></TableRow></TableHeader><TableBody>{marks.map((mark, index) => { const q = test?.questions.find(q => q.id === mark.questionId); return <TableRow key={mark.questionId}><TableCell className="question-cell"><strong>{mark.questionId}</strong><small>{q?.topic}</small></TableCell><TableCell><div className="mark-score"><Input aria-label={`${mark.questionId} marks`} name={`marks-${mark.questionId}`} type="number" min={0} max={q?.maxMarks ?? 100} step={0.5} readOnly={approved} value={mark.awardedMarks ?? ""} onChange={e => change(index, { awardedMarks: e.target.value === "" ? null : Number(e.target.value) })} /><span>/ {q?.maxMarks}</span></div></TableCell><TableCell><NativeSelect aria-label={`${mark.questionId} result`} name={`result-${mark.questionId}`} value={mark.status} disabled={approved} onChange={e => change(index, { status: e.target.value as QuestionMark["status"] })}>{Object.entries(resultLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></TableCell><TableCell className="evidence-cell"><details><summary>{mark.reason || "Check evidence"}</summary><p className="criterion"><strong>Criterion: </strong>{q?.criteria}</p><Field label="Evidence"><Textarea name={`evidence-${mark.questionId}`} rows={2} readOnly={approved} value={mark.evidence} onChange={e => change(index, { evidence: e.target.value })} /></Field><Field label="Reason"><Textarea name={`reason-${mark.questionId}`} rows={2} readOnly={approved} value={mark.reason} onChange={e => change(index, { reason: e.target.value })} /></Field><Field label="Tutor note (optional)"><Textarea name={`note-${mark.questionId}`} rows={2} readOnly={approved} value={mark.tutorNote} onChange={e => change(index, { tutorNote: e.target.value })} /></Field></details></TableCell></TableRow>; })}</TableBody></Table>
      <div className="actions">{approved ? <Button type="button" onClick={onBrief}>Prepare conversation brief</Button> : <><Button type="submit" variant="outline" disabled={busy || !dirty}>Save draft</Button><Button type="button" disabled={busy || dirty || unresolved || submission.status === "awaiting_marking"} onClick={() => { void onApprove().catch(() => {}); }}><Check />Approve results</Button></>}</div><p className="help-text">{approved ? "Approved results are locked and included in exports." : dirty ? "Save your changes before approving." : unresolved ? "Resolve flagged questions and add evidence before approving." : "Check each mark and its evidence, then approve."}</p>
    </form>
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

function ExportForm({ onExport }: { onExport: (kind: string) => Promise<void> }) {
  return <form method="get" action="/api/export" className="export-form" onSubmit={e => { e.preventDefault(); void onExport(String(new FormData(e.currentTarget).get("kind"))); }}><NativeSelect name="kind" aria-label="Admin record type"><option value="marking">Marking sheet</option><option value="progress">Progress evidence</option><option value="exams">Exam results</option></NativeSelect><Button type="submit" variant="outline"><Download />Download CSV</Button></form>;
}

function ActivityForm({ busy, date, onSubmit }: { busy: boolean; date: string; onSubmit: (body: Record<string, unknown>) => Promise<void> }) {
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const element = e.currentTarget; const form = new FormData(element); try { await onSubmit({ date, type: form.get("type"), studentName: form.get("studentName"), count: Number(form.get("count")), notes: form.get("notes") }); element.reset(); } catch { /* Workspace displays the server error. */ } }
  return <form action="/api/activities" method="post" className="form-stack" onSubmit={submit}><Field label="Activity"><NativeSelect name="type">{Object.entries(activityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></Field><div className="two-fields"><Field label="Student label (optional)"><Input name="studentName" maxLength={100} /></Field><Field label="Count"><Input name="count" type="number" min={1} max={1000} defaultValue={1} required /></Field></div><Field label="Notes (optional)"><Textarea name="notes" rows={2} maxLength={4000} placeholder="Support provided or next step." /></Field><Button type="submit" disabled={busy}><Plus />Add activity</Button></form>;
}
function FollowupForm({ busy, date, onSubmit }: { busy: boolean; date: string; onSubmit: (body: Record<string, unknown>) => Promise<void> }) {
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const element = e.currentTarget; const form = new FormData(element); try { await onSubmit({ studentName: form.get("studentName"), task: form.get("task"), dueDate: form.get("dueDate") }); element.reset(); } catch { /* Workspace displays the server error. */ } }
  return <form action="/api/followups" method="post" className="form-stack" onSubmit={submit}><Field label="Student label"><Input name="studentName" maxLength={100} required /></Field><Field label="Next action"><Input name="task" required maxLength={2000} placeholder="Revisit the chain rule together" /></Field><Field label="Due date"><Input name="dueDate" type="date" defaultValue={date} required /></Field><Button type="submit" variant="outline" disabled={busy}><Plus />Add follow-up</Button></form>;
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
