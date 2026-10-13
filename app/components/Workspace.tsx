"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, ChevronDown, Copy, Download, FileCheck2, FileImage, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { calendarDate, generateBriefs, today, validateQuestionMarks } from "@/lib/domain";
import { getFreshFeedback } from "@/lib/report-feedback";
import { adminPrompt, downloadFile, finishPrompt, isMcpApp, markingPrompt, requestApi, uploadPrompt } from "@/lib/host-bridge";
import type { MarkStatus, QuestionMark, SavedBrief, Submission, SubmissionFile, Test, WorkspaceState } from "@/lib/types";

type ResponseData = { state: WorkspaceState; submission?: Submission; error?: string };
const emptyState: WorkspaceState = { tests: [], submissions: [], activities: [], followups: [] };
const statusLabels = { awaiting_marking: "Codex is marking", draft: "Ready for review", approved: "Approved" };
const resultLabels: Record<MarkStatus, string> = { correct: "Correct", wrong: "Incorrect", careless: "Careless error", blank: "Not attempted", review: "Needs review" };
const audiences = ["student", "parent", "manager"] as const;
const audienceLabels = { student: "Student feedback", parent: "Parent talking points", manager: "Manager summary" };
const pluginLink = "codex://plugins/plugin_asdk_app_sites_6a8a554913148191a4ecd150b050413d/app/open_tutor_workspace";
function dateLabel(date: string) { return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`)); }
function json(method: string, body: unknown): RequestInit { return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }; }
async function api(path: string, init?: RequestInit): Promise<ResponseData> {
  const response = await requestApi(path, init);
  const data = await response.json() as ResponseData;
  if (!response.ok) throw new Error(data.error ?? "Could not complete this request.");
  return data;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <Label className="field"><span>{label}</span>{children}</Label>;
}
function Section({ title, description, children, action, className = "" }: { title: string; description?: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return <Card className={className}><CardHeader><div className="section-heading"><CardTitle>{title}</CardTitle>{action}</div>{description && <CardDescription>{description}</CardDescription>}</CardHeader><CardContent>{children}</CardContent></Card>;
}
function CodexIcon() {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/codex-icon.png" alt="" width={20} height={20} className="codex-icon" />;
}
function errorText(error: unknown) { return error instanceof Error ? error.message : "Could not save the change."; }

export default function Workspace() {
  const [state, setState] = useState<WorkspaceState>(emptyState);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [prompt, setPrompt] = useState("");
  const [hasEdits, setHasEdits] = useState(false);
  const [feedbackError, setFeedbackError] = useState(false);
  const knownSubmissions = useRef<Set<string> | null>(null);
  const startingRef = useRef(false);
  const generation = useRef(0);
  const refreshInFlight = useRef(false);
  const approvalInFlight = useRef(false);
  const [watchUntil, setWatchUntil] = useState(0);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    const version = generation.current;
    try {
      const data = await api("/api/workspace");
      if (version !== generation.current) return;
      const newSubmission = knownSubmissions.current && [...data.state.submissions].reverse().find(s => !knownSubmissions.current!.has(s.id));
      knownSubmissions.current = new Set(data.state.submissions.map(s => s.id));
      setState(data.state);
      if (startingRef.current && newSubmission) {
        startingRef.current = false; setStarting(false); setSelectedId(newSubmission.id);
      } else if (!startingRef.current) {
        setSelectedId(current => data.state.submissions.some(s => s.id === current) ? current : data.state.submissions.at(-1)?.id || "");
      }
    } catch (err) { setError(errorText(err)); }
    finally { refreshInFlight.current = false; setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    const update = () => { void refresh(); };
    const status = (event: Event) => {
      const detail = (event as CustomEvent<{ status: string; message?: string; prompt?: string; action?: string }>).detail;
      if (detail.status === "working") setSending(true);
      if (detail.status === "sent" || detail.status === "error") setSending(false);
      if (detail.status === "error") {
        setError(detail.message ?? "The Codex request failed.");
        if (detail.action === "finish") setFeedbackError(true);
      }
      if (detail.prompt) setPrompt(detail.prompt);
      if (detail.status === "sent") { setWatchUntil(Date.now() + 15 * 60 * 1000); void refresh(); }
    };
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("tutor:data-changed", update);
    window.addEventListener("tutor:refresh", update);
    window.addEventListener("tutor:host-status", status);
    return () => {
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("tutor:data-changed", update);
      window.removeEventListener("tutor:refresh", update);
      window.removeEventListener("tutor:host-status", status);
    };
  }, [refresh]);

  useEffect(() => {
    // Save tools are headless. Refresh this mounted page while the agent works.
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      if (isMcpApp() || Date.now() < watchUntil) void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh, watchUntil]);

  async function mutate(path: string, init: RequestInit) {
    generation.current++;
    const data = await api(path, init);
    generation.current++;
    knownSubmissions.current = new Set(data.state.submissions.map(s => s.id));
    setState(data.state);
    return data;
  }
  function dispatchWorkflow(kind: "upload" | "grade" | "finish" | "admin", detail: { submissionId?: string; date?: string } = {}) {
    setError(""); setPrompt(""); setNotice("");
    if (kind === "finish") setFeedbackError(false);
    const handled = !window.dispatchEvent(new CustomEvent(`tutor:${kind}`, { cancelable: true, detail }));
    setWatchUntil(Date.now() + 15 * 60 * 1000);
    if (!handled) {
      setPrompt(kind === "upload" ? uploadPrompt() : kind === "finish" ? finishPrompt(detail.submissionId!, detail.date) : kind === "grade" ? markingPrompt(detail.submissionId!) : adminPrompt(detail.date));
    }
  }
  function startWorkflow() {
    startingRef.current = true; setStarting(true); setSelectedId(""); setHasEdits(false);
    dispatchWorkflow("upload");
  }
  async function saveCorrections(submissionId: string, questions: QuestionMark[], expectedRevision: number) {
    setBusy(true); setError("");
    try {
      const data = await mutate(`/api/submissions/${submissionId}`, json("PATCH", { questions, expectedRevision }));
      setNotice("Corrections saved.");
      return data.state.submissions.find(s => s.id === submissionId)!;
    } catch (err) { setError(errorText(err)); throw err; }
    finally { setBusy(false); }
  }
  async function approve(submissionId: string, questions: QuestionMark[], revision: number, dirty: boolean) {
    if (approvalInFlight.current) return;
    approvalInFlight.current = true; setBusy(true); setError(""); setNotice("");
    try {
      if (dirty) {
        const saved = await mutate(`/api/submissions/${submissionId}`, json("PATCH", { questions, expectedRevision: revision }));
        revision = saved.state.submissions.find(s => s.id === submissionId)!.revision;
      }
      const data = await mutate(`/api/submissions/${submissionId}/approve`, json("POST", { expectedRevision: revision }));
      const submission = data.state.submissions.find(s => s.id === submissionId)!;
      setHasEdits(false);
      dispatchWorkflow("finish", { submissionId, date: calendarDate(submission.approvedAt!) });
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); approvalInFlight.current = false; }
  }
  async function exportOutput(kind: "exhibits" | "feedback", submissionId: string, date: string) {
    setBusy(true); setError("");
    try {
      await downloadFile(`/api/export?kind=${kind}&submissionId=${encodeURIComponent(submissionId)}&date=${date}`, kind === "exhibits" ? `MyTalent-Exhibits-1-2-3-${date}.xlsx` : `MyTalent-Feedback-${date}.html`);
      setNotice(kind === "exhibits" ? "Exhibits 1–3 downloaded in one workbook." : "Feedback form downloaded. Open it to print or save as PDF.");
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setNotice("Copied."); }
    catch { setPrompt(text); }
  }

  const selected = state.submissions.find(s => s.id === selectedId);
  const test = state.tests.find(t => t.id === selected?.testId);
  const feedback = selected ? getFreshFeedback(state, selected.id) : null;
  const isApproved = selected?.status === "approved";
  const phase = !selected || starting ? 1 : isApproved ? 3 : 2;
  const daily = generateBriefs(state).manager;

  return <div className="tutor-app">
    <a href="#main" className="skip-link">Skip to workspace</a>
    <header className="app-header"><div className="app-brand">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/mytalent-logo.png" alt="" width={42} height={34} className="brand-logo" />
      <div><h1>MyTalent Education</h1><p>Marking, made simpler.</p></div>
    </div><Button variant="ghost" size="icon" aria-label="Refresh workspace" onClick={() => { setError(""); void refresh(); }}><RefreshCw className={loading ? "animate-spin" : ""} /></Button></header>
    <main id="main" className="workflow-page">
      <ol className="journey" aria-label="Marking workflow">{["Upload", "Review", "Ready"].map((label, index) => <li key={label} className={phase === index + 1 ? "active" : phase > index + 1 ? "complete" : ""} aria-current={phase === index + 1 ? "step" : undefined}><span>{phase > index + 1 ? <Check size={12} /> : index + 1}</span>{label}</li>)}</ol>
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      {notice && <p className="inline-notice" role="status"><Check size={14} />{notice}</p>}
      {prompt && <Section title="Continue in Codex" description="Open MyTalent in Codex and attach the student’s paper and marking rubric there."><div className="actions"><Button asChild><a href={pluginLink}><CodexIcon />Open in Codex<ArrowRight /></a></Button><Button variant="outline" onClick={() => void copy(prompt)}><Copy />Copy request</Button></div><details className="evidence-details"><summary>View request</summary><Textarea aria-label="Prepared Codex request" value={prompt} readOnly rows={5} /></details></Section>}
      {loading ? <div className="loading" role="status"><LoaderCircle className="animate-spin" />Opening workspace…</div> : <>
        {!selected && <section className="start-panel">
          <div className="start-icon"><FileImage size={23} /></div>
          <h2>{starting ? "Add your paper and rubric." : "You teach. Codex does the paperwork."}</h2>
          <p>{starting ? "In the conversation, attach every page of the student’s work and the marking rubric. Codex will check the full paper and prepare the marks here." : "Upload the work and rubric in Codex. Review the marks here. Approve once for feedback and all three Exhibits."}</p>
          {starting ? <div className="upload-wait" role="status"><LoaderCircle size={16} className="animate-spin" />Waiting for your files in Codex</div> : <Button onClick={startWorkflow} disabled={busy || sending}><CodexIcon />Mark student work with Codex<ArrowRight /></Button>}
          <div className="required-files"><span><FileImage size={14} />All student work pages</span><span><FileCheck2 size={14} />Marking rubric required</span></div>
          {starting && <Button variant="ghost" size="sm" onClick={() => { startingRef.current = false; setStarting(false); setSelectedId(state.submissions.at(-1)?.id || ""); }}>Back to saved work</Button>}
        </section>}
        {selected && <>
          <div className="paper-toolbar"><div className="active-paper"><span className="eyebrow">CURRENT PAPER</span>{state.submissions.length > 1 ? <NativeSelect aria-label="Current student paper" value={selectedId} disabled={busy || hasEdits} onChange={e => { setSelectedId(e.target.value); setError(""); setNotice(""); }} >{[...state.submissions].reverse().map(s => <option key={s.id} value={s.id}>{s.studentName} · {state.tests.find(t => t.id === s.testId)?.title} · {statusLabels[s.status]}</option>)}</NativeSelect> : <strong>{selected.studentName}</strong>}</div><Button variant="outline" size="sm" onClick={startWorkflow} disabled={busy || sending || hasEdits}><Plus size={14} />New paper</Button></div>
          {isApproved ? <div className="approval-banner"><span className="approval-icon"><Check size={18} /></span><div><strong>Marking approved</strong><p>{selected.studentName} · {test?.title} · {selected.questions.reduce((sum, q) => sum + (q.awardedMarks ?? 0), 0)}/{test?.questions.reduce((sum, q) => sum + q.maxMarks, 0)} marks</p></div></div> : <ReviewEditor key={selected.id} submission={selected} test={test} busy={busy || sending} onDirty={setHasEdits} onAsk={() => dispatchWorkflow("grade", { submissionId: selected.id })} onRestart={startWorkflow} onSave={(questions, revision) => saveCorrections(selected.id, questions, revision)} onApprove={(questions, revision, dirty) => approve(selected.id, questions, revision, dirty)} />}
          {isApproved && feedback && <>
            <Section title="Your feedback" description={feedback.complete ? "Prepared from the marks you approved. Read it here or download the form." : "Codex is preparing student, parent and manager feedback. This page updates automatically."} action={feedback.complete ? <Badge variant="secondary"><Check size={12} />Ready</Badge> : <LoaderCircle size={17} className="animate-spin" />}>
              <div className="feedback-list">{audiences.map(audience => <FeedbackItem key={audience} title={audienceLabels[audience]} brief={feedback[audience]} open={audience === "student"} />)}</div>
              <div className="actions"><Button disabled={!feedback.complete || busy} onClick={() => void exportOutput("feedback", selected.id, feedback.date)}><Download />Download feedback form</Button>{!feedback.complete && <Button variant="ghost" disabled={sending || busy} onClick={() => dispatchWorkflow("finish", { submissionId: selected.id, date: feedback.date })}>{feedbackError ? "Retry feedback" : "Resume preparation"}</Button>}</div>
            </Section>
            <Section title="Exhibits 1, 2 & 3" description="Updated from approved marking. Download all three in one Excel workbook." action={<FileCheck2 size={18} className="muted-icon" />}>
              <div className="output-list"><div><span>01</span><p><strong>Marking sheet</strong><small>Every question, outcome and supporting evidence</small></p><Check size={15} /></div><div><span>02</span><p><strong>Student progress</strong><small>Topic evidence from recorded work</small></p><Check size={15} /></div><div><span>03</span><p><strong>Exam statistics</strong><small>Approved scores and recorded attempts</small></p><Check size={15} /></div></div>
              <div className="actions"><Button disabled={busy} onClick={() => void exportOutput("exhibits", selected.id, feedback.date)}><Download />Download all 3 Exhibits</Button></div>
              <p className="scope-note">Progress reflects the supplied topics. Full-course mastery needs the course catalogue and tutor assessment.</p>
            </Section>
            <details className="archive-details"><summary>View approved marks <ChevronDown size={14} /></summary><ApprovedMarks submission={selected} test={test} /></details>
          </>}
        </>}
        {!selected && !starting && !state.submissions.length && <div className="empty-workflow"><span>1 click to start</span><span>Review & approve</span><span>Feedback + 3 Exhibits</span></div>}
        {!selected && !starting && state.submissions.length > 0 && <Button variant="ghost" onClick={() => setSelectedId(state.submissions.at(-1)!.id)}>Return to saved work</Button>}
        <details className="daily-details"><summary>Daily log <span>{daily.papersMarked} approved today</span><ChevronDown size={14} /></summary><p>Record support, contacts and follow-ups with Codex.</p><Button variant="outline" size="sm" disabled={sending || busy} onClick={() => dispatchWorkflow("admin", { date: today() })}><CodexIcon />Update daily log</Button></details>
      </>}
    </main>
    <footer className="app-footer"><span>Prepared by Codex. Reviewed by you.</span><span>MyTalent</span></footer>
  </div>;
}

function ReviewEditor({ submission, test, busy, onDirty, onAsk, onRestart, onSave, onApprove }: { submission: Submission; test?: Test; busy: boolean; onDirty: (dirty: boolean) => void; onAsk: () => void; onRestart: () => void; onSave: (questions: QuestionMark[], revision: number) => Promise<Submission>; onApprove: (questions: QuestionMark[], revision: number, dirty: boolean) => Promise<void> }) {
  const [rows, setRows] = useState(() => structuredClone(submission.questions));
  const [revision, setRevision] = useState(submission.revision);
  const [dirty, setDirty] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const conflict = dirty && revision !== submission.revision;
  useEffect(() => {
    if (!dirty) { setRows(structuredClone(submission.questions)); setRevision(submission.revision); }
  }, [submission.revision, submission.questions, dirty]);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  const hasUploadedRubric = Boolean(test?.rubricAttachmentNames?.length && submission.paperQuestionIds?.length);
  const awaiting = submission.status === "awaiting_marking";
  let approvalIssue = "";
  try { if (test) validateQuestionMarks(test, rows, true); else approvalIssue = "The marking rubric is missing."; } catch (err) { approvalIssue = errorText(err); }
  const score = rows.reduce((sum, row) => sum + (row.awardedMarks ?? 0), 0);
  const maxScore = test?.questions.reduce((sum, q) => sum + q.maxMarks, 0) ?? 0;
  function change(index: number, values: Partial<QuestionMark>) { setRows(current => current.map((row, i) => i === index ? { ...row, ...values } : row)); setDirty(true); setSavedMessage(""); }
  async function save() {
    try { const saved = await onSave(rows, revision); setRows(structuredClone(saved.questions)); setRevision(saved.revision); setDirty(false); setSavedMessage("Corrections saved."); } catch { /* Parent shows the request error. */ }
  }
  return <Section title={awaiting ? "Codex is marking your paper" : "Review the suggested marks"} description={`${submission.studentName} · ${test?.title ?? "Uploaded paper"}`} action={<Badge variant="outline">{statusLabels[submission.status]}</Badge>}>
    {!hasUploadedRubric ? <div className="review-blocker"><p>This older record has no uploaded rubric or full-paper check. Start a new marking session with all work pages and the complete rubric.</p><Button onClick={onRestart} disabled={busy}><CodexIcon />Upload paper & rubric</Button></div> : awaiting ? <div className="marking-wait" role="status"><LoaderCircle className="animate-spin" size={18} /><p>Codex is checking every question against your rubric.<small>The draft will appear here automatically.</small></p><Button variant="ghost" size="sm" onClick={onAsk} disabled={busy}>Resume with Codex</Button></div> : <>
      <div className="review-summary"><strong>{score}<span> / {maxScore}</span></strong><div><span>{rows.length} question parts</span><span>{dateLabel(submission.date)}</span></div></div>
      <p className="review-intro">Check the marks and feedback below. Edit anything that needs correcting, then approve once.</p>
      {conflict && <Alert variant="destructive" role="alert"><AlertDescription>Codex saved a newer draft while you were editing. Your edits are still here. Reload the latest marks before continuing.</AlertDescription><Button variant="outline" size="sm" onClick={() => { setDirty(false); setRows(structuredClone(submission.questions)); setRevision(submission.revision); }}>Load latest marks</Button></Alert>}
      <div className="question-reviews">{rows.map((row, index) => { const question = test?.questions.find(q => q.id === row.questionId); return <article className={`question-review ${row.status === "review" ? "needs-review" : ""}`} key={row.questionId}>
        <div className="question-heading"><div><strong>{row.questionId}</strong><span>{question?.topic}</span></div><Label className="mark-score"><span className="sr-only">{row.questionId} marks</span><Input type="number" aria-label={`${row.questionId} marks`} min={0} max={question?.maxMarks} step={test?.markIncrement ?? 1} value={row.awardedMarks ?? ""} disabled={busy || conflict} onChange={e => { const marks = e.target.value === "" ? null : Number(e.target.value); change(index, { awardedMarks: marks, status: marks === null ? "review" : marks === question?.maxMarks ? "correct" : row.status === "blank" && marks === 0 ? "blank" : row.status === "careless" ? "careless" : "wrong" }); }} /><span>/ {question?.maxMarks}</span></Label></div>
        <div className="question-result"><NativeSelect aria-label={`${row.questionId} outcome`} value={row.status} disabled={busy || conflict} onChange={e => { const status = e.target.value as MarkStatus; change(index, { status, ...(status === "correct" ? { awardedMarks: question?.maxMarks ?? null } : status === "blank" ? { awardedMarks: 0 } : status === "review" ? { awardedMarks: null } : {}) }); }}>{Object.entries(resultLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></div>
        <Field label="Marking feedback"><Textarea aria-label={`${row.questionId} marking feedback`} rows={2} value={row.reason} disabled={busy || conflict} onChange={e => change(index, { reason: e.target.value })} /></Field>
        <details className="question-edit"><summary>Evidence, criteria & next practice</summary><p className="criterion">{question?.criteria}</p><Field label="Evidence from the paper"><Textarea aria-label={`${row.questionId} evidence`} rows={2} value={row.evidence} disabled={busy || conflict} onChange={e => change(index, { evidence: e.target.value })} /></Field><Field label="Next practice / tutor note"><Textarea aria-label={`${row.questionId} next practice`} rows={2} value={row.tutorNote} disabled={busy || conflict} onChange={e => change(index, { tutorNote: e.target.value })} /></Field></details>
      </article>; })}</div>
      <div className="review-actions"><div><Button onClick={() => void onApprove(rows, revision, dirty)} disabled={busy || conflict || Boolean(approvalIssue)}>{busy ? <LoaderCircle className="animate-spin" /> : <Check />}Approve & prepare feedback</Button>{dirty && <Button variant="outline" onClick={() => void save()} disabled={busy || conflict}>Save corrections</Button>}</div><p role="status">{savedMessage || (approvalIssue ? approvalIssue : "Your corrections save with approval. Feedback and all 3 Exhibits follow automatically.")}</p></div>
      <Button className="codex-revision" variant="ghost" size="sm" onClick={onAsk} disabled={busy || dirty}><CodexIcon />Ask Codex to revisit the marking</Button>
    </>}
    <PaperEvidence submission={submission} test={test} />
  </Section>;
}

function FeedbackItem({ title, brief, open }: { title: string; brief?: SavedBrief; open: boolean }) {
  if (!brief) return <div className="feedback-pending"><span>{title}</span><span><LoaderCircle size={12} className="animate-spin" />Preparing</span></div>;
  return <details className="feedback-item" open={open}><summary><span>{title}</span><span><Check size={13} />Ready<ChevronDown size={13} /></span></summary><p className="saved-brief-text">{brief.text}</p></details>;
}
function ApprovedMarks({ submission, test }: { submission: Submission; test?: Test }) {
  return <div className="approved-marks">{submission.questions.map(q => <div key={q.questionId}><strong>{q.questionId} · {q.awardedMarks}/{test?.questions.find(question => question.id === q.questionId)?.maxMarks}</strong><p>{q.reason}</p>{q.tutorNote && <small>{q.tutorNote}</small>}</div>)}<PaperEvidence submission={submission} test={test} /></div>;
}
function PaperEvidence({ submission, test }: { submission: Submission; test?: Test }) {
  const [activeFile, setActiveFile] = useState(0);
  return <details className="paper-details"><summary>Paper & uploaded rubric</summary><p className="help-text">{submission.inputSource === "chat" ? `Original work stays in your conversation: ${submission.chatAttachmentNames?.join(", ") || "attached paper"}.` : "Original uploaded work."}</p>{test?.rubricAttachmentNames?.length ? <p className="help-text">Rubric: {test.rubricAttachmentNames.join(", ")}</p> : <p className="help-text">Historical record · uploaded rubric not recorded.</p>}{submission.files.length > 0 && <><div className="actions">{submission.files.map((file, i) => <Button size="sm" variant={activeFile === i ? "secondary" : "outline"} key={file.id} onClick={() => setActiveFile(i)}>Page {i + 1}</Button>)}</div><ProtectedFile key={submission.files[activeFile]?.id ?? submission.files[0].id} file={submission.files[activeFile] ?? submission.files[0]} /></>}<details className="evidence-details"><summary>Extracted marking criteria</summary><pre>{test?.guideText}</pre></details></details>;
}
function ProtectedFile({ file }: { file: SubmissionFile }) {
  const [url, setUrl] = useState(""); const [error, setError] = useState("");
  useEffect(() => { let objectUrl = ""; let cancelled = false; void requestApi(`/api/files/${file.id}`).then(async response => { if (!response.ok) throw new Error("Could not open this page."); objectUrl = URL.createObjectURL(await response.blob()); if (!cancelled) setUrl(objectUrl); }).catch(err => { if (!cancelled) setError(errorText(err)); }); return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); }; }, [file.id]);
  if (error) return <p className="form-error">{error}</p>;
  if (!url) return <p className="help-text">Opening paper…</p>;
  // eslint-disable-next-line @next/next/no-img-element
  return <div className="paper-preview">{file.mimeType === "application/pdf" ? <object data={url} type="application/pdf" aria-label={file.name} /> : <img src={url} alt={`Student paper: ${file.name}`} />}</div>;
}
