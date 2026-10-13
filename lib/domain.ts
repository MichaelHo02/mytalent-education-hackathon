import type { Activity, ActivityType, CreateSubmissionInput, ExhibitMarkingRow, ExhibitOutcome, ExhibitProgressRow, ExportKind, Followup, MarkStatus, QuestionMark, SavedBrief, Submission, Test, WorkspaceBriefs, WorkspaceExhibits, WorkspaceState } from "./types";

export class WorkspaceError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = "WorkspaceError"; }
}
export function emptyWorkspace(): WorkspaceState { return { tests: [], submissions: [], activities: [], followups: [] }; }
export function today(): string { return calendarDate(new Date().toISOString()); }
export function calendarDate(iso: string): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)); }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkspaceError("Provide an object with the required fields.");
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, max: number, optional = false): string {
  if (optional && (value === undefined || value === null)) return "";
  if (typeof value !== "string") throw new WorkspaceError(`${name} must be text.`);
  const result = value.trim();
  if ((!optional && !result) || result.length > max) throw new WorkspaceError(`${name} ${!result ? "is required" : `must have at most ${max} characters`}.`);
  return result;
}
export function validateDate(value: unknown, name = "Date"): string {
  const result = text(value, name, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(result + "T00:00:00Z")) || new Date(result + "T00:00:00Z").toISOString().slice(0, 10) !== result) throw new WorkspaceError(`${name} must be a real date in YYYY-MM-DD format.`);
  return result;
}
export function validateRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new WorkspaceError("expectedRevision must be a non-negative integer.");
  return value;
}
function rubricAttachments(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) throw new WorkspaceError("Upload the marking rubric for the complete paper and start a new marking workflow. Record between 1 and 20 actual rubric attachment names; a default or saved guide alone is not sufficient.");
  const names = value.map(name => text(name, "Uploaded rubric attachment name", 240));
  if (new Set(names).size !== names.length) throw new WorkspaceError("Use unique uploaded rubric attachment names.");
  return names;
}
function paperCoverage(test: Test, value: unknown): string[] {
  rubricAttachments(test.rubricAttachmentNames);
  if (test.markIncrement !== 0.5 && test.markIncrement !== 1) throw new WorkspaceError("Upload the complete marking rubric and start a new marking workflow with its explicit mark increment.");
  if (!Array.isArray(value) || value.length === 0 || value.length > 60) throw new WorkspaceError("Upload every page of the complete student paper and its rubric, then start a new marking workflow. Record all observed paper question and subpart IDs (1 to 60).");
  const ids = value.map(id => text(id, "Observed paper question or subpart ID", 40));
  if (new Set(ids).size !== ids.length) throw new WorkspaceError("Observed paper question and subpart IDs must be unique.");
  const rubricIds = new Set(test.questions.map(question => question.id));
  const paperIds = new Set(ids);
  const missingRubric = ids.filter(id => !rubricIds.has(id));
  const absentFromPaper = [...rubricIds].filter(id => !paperIds.has(id));
  if (missingRubric.length || absentFromPaper.length) throw new WorkspaceError(`The uploaded rubric must match the complete paper, including every question and subpart.${missingRubric.length ? ` Missing from rubric: ${missingRubric.join(", ")}.` : ""}${absentFromPaper.length ? ` Not found in the observed paper: ${absentFromPaper.join(", ")}.` : ""} Upload the complete matching materials and start a new marking workflow.`);
  return ids;
}
export function makeTest(input: unknown, id: string, createdAt: string): Test {
  const value = object(input);
  const rubricAttachmentNames = rubricAttachments(value.rubricAttachmentNames);
  const markIncrement = value.markIncrement;
  if (markIncrement !== 0.5 && markIncrement !== 1) throw new WorkspaceError("Provide the uploaded rubric's mark increment: 0.5 or 1. No default mark increment is assumed.");
  if (!Array.isArray(value.questions) || !value.questions.length || value.questions.length > 60) throw new WorkspaceError("Provide between 1 and 60 questions.");
  const ids = new Set<string>();
  const questions = value.questions.map(item => {
    const question = object(item); const questionId = text(question.id, "Question ID", 40);
    if (ids.has(questionId)) throw new WorkspaceError(`Question ID ${questionId} is duplicated.`);
    ids.add(questionId);
    if (typeof question.maxMarks !== "number" || !Number.isFinite(question.maxMarks) || question.maxMarks <= 0 || question.maxMarks > 100 || question.maxMarks % markIncrement !== 0) throw new WorkspaceError(`Maximum marks must be a positive number in ${markIncrement}-mark increments, at most 100.`);
    return { id: questionId, topic: text(question.topic, "Topic", 120), maxMarks: question.maxMarks, criteria: text(question.criteria, "Marking criteria", 6000) };
  });
  return { id, title: text(value.title, "Test title", 160), guideText: text(value.guideText, "Worked solutions and guide", 120000), questions, rubricAttachmentNames, markIncrement, createdAt };
}
export function makeSubmission(state: WorkspaceState, input: CreateSubmissionInput, id: string, createdAt: string): Submission {
  const test = state.tests.find(item => item.id === input.testId);
  if (!test) throw new WorkspaceError("Test not found.", 404);
  if (!Array.isArray(input.files) || input.files.length === 0 || input.files.length > 20) throw new WorkspaceError("Upload between 1 and 20 pages or PDFs.");
  const paperQuestionIds = paperCoverage(test, input.paperQuestionIds);
  return { id, testId: test.id, studentName: text(input.studentName, "Student name or alias", 100), date: validateDate(input.date), files: input.files, inputSource: "workspace", paperQuestionIds, questions: test.questions.map(q => ({ questionId: q.id, awardedMarks: null, status: "review", evidence: "", reason: "", tutorNote: "" })), status: "awaiting_marking", revision: 0, createdAt };
}
export function makeChatSubmission(state: WorkspaceState, input: unknown, id: string, createdAt: string): Submission {
  const value = object(input); const testId = text(value.testId, "Test ID", 100);
  const test = state.tests.find(item => item.id === testId);
  if (!test) throw new WorkspaceError("Test not found.", 404);
  if (!Array.isArray(value.chatAttachmentNames) || value.chatAttachmentNames.length === 0 || value.chatAttachmentNames.length > 20) throw new WorkspaceError("List between 1 and 20 attachment names from the current conversation.");
  const chatAttachmentNames = value.chatAttachmentNames.map(name => text(name, "Chat attachment name", 240));
  if (new Set(chatAttachmentNames).size !== chatAttachmentNames.length) throw new WorkspaceError("Use unique attachment names so the tutor can identify each page.");
  const paperQuestionIds = paperCoverage(test, value.paperQuestionIds);
  return { id, testId, studentName: text(value.studentName, "Student name or alias", 100), date: validateDate(value.date), files: [], inputSource: "chat", chatAttachmentNames, paperQuestionIds, questions: test.questions.map(q => ({ questionId: q.id, awardedMarks: null, status: "review", evidence: "", reason: "", tutorNote: "" })), status: "awaiting_marking", revision: 0, createdAt };
}
export function findSubmission(state: WorkspaceState, id: string): Submission {
  const result = state.submissions.find(item => item.id === id);
  if (!result) throw new WorkspaceError("Submission not found.", 404);
  return result;
}
export function validateQuestionMarks(test: Test, input: unknown, forApproval = false): QuestionMark[] {
  if (!Array.isArray(input) || input.length !== test.questions.length) throw new WorkspaceError("Include exactly one marking row for every question in the test.");
  const seen = new Set<string>();
  const allowed: MarkStatus[] = ["correct", "wrong", "careless", "blank", "review"];
  const markIncrement = test.markIncrement ?? 0.5;
  const result = input.map(item => {
    const value = object(item); const questionId = text(value.questionId, "Question ID", 40);
    const rubric = test.questions.find(q => q.id === questionId);
    if (!rubric || seen.has(questionId)) throw new WorkspaceError(`Unknown or duplicate question ${questionId}.`);
    seen.add(questionId);
    const status = value.status as MarkStatus;
    if (!allowed.includes(status)) throw new WorkspaceError(`Invalid result status for ${questionId}.`);
    const marks = value.awardedMarks;
    if (marks !== null && (typeof marks !== "number" || !Number.isFinite(marks) || marks < 0 || marks > rubric.maxMarks || marks % markIncrement !== 0)) throw new WorkspaceError(`Marks for ${questionId} must be between 0 and ${rubric.maxMarks} in ${markIncrement}-mark increments.`);
    const evidence = text(value.evidence, "Evidence", 6000, true); const reason = text(value.reason, "Marking explanation", 6000, true);
    if (status === "blank" && marks !== 0) throw new WorkspaceError(`Unanswered question ${questionId} must receive 0 marks.`);
    if (status === "correct" && marks !== rubric.maxMarks) throw new WorkspaceError(`Correct question ${questionId} must receive full marks.`);
    if (forApproval && (status === "review" || marks === null)) throw new WorkspaceError(`Resolve the mark and review status for ${questionId} before approving.`);
    if (forApproval && status !== "blank" && (!evidence || !reason)) throw new WorkspaceError(`Add evidence and an explanation for ${questionId} before approving.`);
    return { questionId, awardedMarks: marks as number | null, status, evidence, reason, tutorNote: text(value.tutorNote, "Tutor note", 4000, true) };
  });
  return test.questions.map(q => result.find(mark => mark.questionId === q.id)!);
}
function revisionCheck(submission: Submission, revision: unknown): void {
  if (submission.revision !== validateRevision(revision)) throw new WorkspaceError("This submission changed in another window. Reload before saving.", 409);
  if (submission.status === "approved") throw new WorkspaceError("Approved marking is locked. Create another submission to record a new attempt.", 409);
}
export function draftMarking(state: WorkspaceState, id: string, questions: unknown, expectedRevision: unknown): WorkspaceState {
  const submission = findSubmission(state, id); revisionCheck(submission, expectedRevision);
  const test = state.tests.find(item => item.id === submission.testId)!;
  paperCoverage(test, submission.paperQuestionIds);
  const updated: Submission = { ...submission, status: "draft", questions: validateQuestionMarks(test, questions), revision: submission.revision + 1 };
  return { ...state, submissions: state.submissions.map(item => item.id === id ? updated : item) };
}
export function approveMarking(state: WorkspaceState, id: string, expectedRevision: unknown, approvedAt: string): WorkspaceState {
  const submission = findSubmission(state, id); revisionCheck(submission, expectedRevision);
  const test = state.tests.find(item => item.id === submission.testId)!;
  paperCoverage(test, submission.paperQuestionIds);
  const updated: Submission = { ...submission, status: "approved", questions: validateQuestionMarks(test, submission.questions, true), revision: submission.revision + 1, approvedAt };
  return { ...state, submissions: state.submissions.map(item => item.id === id ? updated : item) };
}
export function makeActivity(input: unknown, id: string): Activity {
  const value = object(input); const types: ActivityType[] = ["attendance", "qa", "parent_contact", "sac_support"];
  if (!types.includes(value.type as ActivityType)) throw new WorkspaceError("Select a supported activity type.");
  if (typeof value.count !== "number" || !Number.isInteger(value.count) || value.count < 1 || value.count > 100) throw new WorkspaceError("Activity count must be a whole number from 1 to 100.");
  return { id, date: validateDate(value.date), type: value.type as ActivityType, studentName: text(value.studentName, "Student name or alias", 100, true), count: value.count, notes: text(value.notes, "Activity notes", 4000, true) };
}
export function makeFollowup(input: unknown, id: string): Followup {
  const value = object(input);
  return { id, studentName: text(value.studentName, "Student name or alias", 100), task: text(value.task, "Follow-up task", 2000), dueDate: validateDate(value.dueDate, "Due date"), done: false };
}
export function makeSavedBrief(state: WorkspaceState, input: unknown, id: string, createdAt: string): SavedBrief {
  const value = object(input);
  if (!["student", "parent", "manager"].includes(value.audience as string)) throw new WorkspaceError("Select student, parent or manager as the audience.");
  const date = validateDate(value.date);
  const submissionId = value.submissionId === undefined ? undefined : text(value.submissionId, "Submission ID", 100);
  if (value.audience !== "manager" && !submissionId) throw new WorkspaceError("Student and parent briefs require an approved submission.");
  if (submissionId && findSubmission(state, submissionId).status !== "approved") throw new WorkspaceError("Briefs can use only approved marking.");
  if (!Array.isArray(value.evidenceRefs) || !value.evidenceRefs.length || value.evidenceRefs.length > 100 || new Set(value.evidenceRefs).size !== value.evidenceRefs.length) throw new WorkspaceError("Provide unique evidence references for this brief.");
  const revisions = object(value.sourceRevisions); const used = new Set<string>();
  const activityIds = new Set(state.activities.filter(a => a.date === date).map(a => a.id));
  const evidenceRefs = value.evidenceRefs.map(ref => {
    const reference = text(ref, "Evidence reference", 200);
    if (activityIds.has(reference)) {
      if (value.audience !== "manager") throw new WorkspaceError("Student and parent briefs must cite their selected approved submission only.");
      return reference;
    }
    const source = state.submissions.find(s => s.status === "approved" && (s.id === reference || s.questions.some(q => `${s.id}:${q.questionId}` === reference)));
    if (!source || (submissionId && source.id !== submissionId)) throw new WorkspaceError(`Evidence ${reference} must refer to an approved submission, its question, or a recorded activity.`);
    if (revisions[source.id] !== source.revision) throw new WorkspaceError("Brief source marking changed. Generate the brief again.", 409);
    used.add(source.id); return reference;
  });
  if (Object.keys(revisions).some(key => !used.has(key))) throw new WorkspaceError("sourceRevisions must match the submissions cited in the brief.");
  if (submissionId && !used.has(submissionId)) throw new WorkspaceError("Cite the approved submission that this brief discusses.");
  return { id, submissionId, audience: value.audience as SavedBrief["audience"], date, text: text(value.text, "Brief text", 20000), evidenceRefs, sourceRevisions: Object.fromEntries([...used].map(key => [key, revisions[key] as number])), createdAt };
}
export function generateBriefs(state: WorkspaceState, date = today()): WorkspaceBriefs {
  const approved = state.submissions.filter(s => s.status === "approved");
  const student = approved.flatMap(submission => {
    const test = state.tests.find(t => t.id === submission.testId); if (!test) return [];
    const score = submission.questions.reduce((sum, q) => sum + (q.awardedMarks ?? 0), 0); const maxScore = test.questions.reduce((sum, q) => sum + q.maxMarks, 0);
    const strengths: string[] = []; const nextSteps: string[] = []; const evidence: string[] = [];
    for (const mark of submission.questions) {
      const q = test.questions.find(item => item.id === mark.questionId)!;
      evidence.push(`${q.id} (${q.topic}): ${mark.awardedMarks}/${q.maxMarks}. ${mark.status === "blank" ? "Not attempted." : mark.evidence} ${mark.reason}${mark.tutorNote ? ` Tutor note: ${mark.tutorNote}` : ""}`.trim());
      if (mark.awardedMarks === q.maxMarks) strengths.push(`${q.topic}: full marks on ${q.id} (${q.maxMarks}/${q.maxMarks}).`);
      else nextSteps.push(`${q.id} — revisit ${q.topic}. ${mark.status === "blank" ? "Attempt this question with the tutor." : mark.tutorNote || mark.reason}`);
    }
    return [{ submissionId: submission.id, studentName: submission.studentName, testTitle: test.title, date: submission.date, score, maxScore, strengths, nextSteps, evidence, parentTalkingPoints: [`${submission.studentName} scored ${score}/${maxScore} on ${test.title} (${submission.date}); the tutor approved these marks.`, ...strengths.slice(0, 2), ...nextSteps.slice(0, 3)] }];
  });
  const markedToday = approved.filter(s => s.approvedAt && calendarDate(s.approvedAt) === date);
  const activities: Record<ActivityType, number> = { attendance: 0, qa: 0, parent_contact: 0, sac_support: 0 };
  for (const activity of state.activities.filter(a => a.date === date)) activities[activity.type] += activity.count;
  const followups = state.followups.filter(f => !f.done).map(f => `${f.studentName}: ${f.task} (due ${f.dueDate}).`);
  return { student, manager: { date, papersMarked: markedToday.length, marksReviewed: markedToday.reduce((sum, s) => sum + s.questions.length, 0), activities, followups, talkingPoints: [`${markedToday.length} paper(s) approved on ${date}; ${markedToday.reduce((sum, s) => sum + s.questions.length, 0)} question result(s) reviewed.`, `Recorded activity counts: attendance ${activities.attendance}, Q&A ${activities.qa}, parent contacts ${activities.parent_contact}, SAC support ${activities.sac_support}.`, ...followups] } };
}
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  // Excel can interpret formulas after leading whitespace. Quote and neutralise all such text.
  if (/^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}
export function generateExhibits(state: WorkspaceState): WorkspaceExhibits {
  const approved = state.submissions.filter(s => s.status === "approved").sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const outcomes: Record<Exclude<MarkStatus, "review">, ExhibitOutcome> = { correct: "DONE", wrong: "W", careless: "C", blank: "Blank" };
  const marking: ExhibitMarkingRow[] = [];
  const tests = new Map(state.tests.map(test => [test.id, test]));
  for (const submission of approved) {
    const test = tests.get(submission.testId);
    if (!test) throw new WorkspaceError("An approved submission is missing its test.");
    // Reuse approval validation so malformed stored rows cannot become official records.
    for (const mark of validateQuestionMarks(test, submission.questions, true)) {
      const question = test.questions.find(q => q.id === mark.questionId)!;
      marking.push({ studentName: submission.studentName, testId: test.id, testTitle: test.title, submissionId: submission.id, date: submission.date, questionId: question.id, topic: question.topic, marks: mark.awardedMarks!, maxMarks: question.maxMarks, outcome: outcomes[mark.status as Exclude<MarkStatus, "review">], evidence: mark.evidence || (mark.status === "blank" ? "Not attempted." : ""), reason: mark.reason, tutorNote: mark.tutorNote, approvedAt: submission.approvedAt ?? "" });
    }
  }
  // Exact saved aliases and topic labels are the available grouping keys. A test
  // catalogue is not a complete course catalogue, and marks are not mastery.
  const students = [...new Set(approved.map(s => s.studentName))];
  const topics = [...new Set(state.tests.flatMap(test => test.questions.map(q => q.topic)))];
  const progress: ExhibitProgressRow[] = students.flatMap(studentName => topics.map(topic => {
    const source = marking.filter(row => row.studentName === studentName && row.topic === topic);
    const marks = source.reduce((sum, row) => sum + row.marks, 0);
    const maxMarks = source.reduce((sum, row) => sum + row.maxMarks, 0);
    const counts: Record<ExhibitOutcome, number> = { DONE: 0, W: 0, C: 0, Blank: 0 };
    for (const row of source) counts[row.outcome] += 1;
    return { studentName, topic, marks, maxMarks, percentage: maxMarks ? Math.round(marks / maxMarks * 10000) / 100 : null, evidenceCount: source.length, evidenceStatus: source.length ? "Approved evidence" : "No approved evidence", mastery: "Tutor confirmation needed", evidenceRefs: source.map(row => `${row.submissionId}:${row.questionId}`), evidence: source.map(row => `${row.testTitle} (${row.date}), ${row.questionId}: ${row.marks}/${row.maxMarks}. ${row.evidence} ${row.reason}`.trim()), nextSteps: [...new Set(source.filter(row => row.marks < row.maxMarks).map(row => row.tutorNote || row.reason || `Review ${topic} with the tutor.`))], latestDate: source.at(-1)?.date ?? null, outcomes: counts };
  }));
  const attempts = new Map<string, Submission[]>();
  for (const submission of approved) {
    const key = JSON.stringify([submission.studentName, submission.testId]);
    const group = attempts.get(key) ?? [];
    group.push(submission); attempts.set(key, group);
  }
  const exams = approved.map(submission => {
    const test = tests.get(submission.testId)!;
    const source = marking.filter(row => row.submissionId === submission.id);
    const score = source.reduce((sum, row) => sum + row.marks, 0);
    const maxScore = source.reduce((sum, row) => sum + row.maxMarks, 0);
    const group = attempts.get(JSON.stringify([submission.studentName, submission.testId]))!;
    return { studentName: submission.studentName, testId: test.id, testTitle: test.title, submissionId: submission.id, date: submission.date, score, maxScore, percentage: Math.round(score / maxScore * 10000) / 100, recordedAttempt: group.findIndex(row => row.id === submission.id) + 1, recordedAttempts: group.length, approvedAt: submission.approvedAt ?? "" };
  });
  return { marking, progress, exams, scope: { progress: "Topics from saved tests only. Percentages summarise approved question marks, not course coverage or mastery. Grouped by exact student alias and topic label; tutor confirmation is needed for mastery.", exams: "Recorded attempts include approved submissions in this workspace for the same student alias and saved test, ordered by test date. They do not establish lifetime attempt history, class membership or pass/fail decisions." } };
}
export function exportWorkspaceCsv(state: WorkspaceState, kind: ExportKind, date = today()): string {
  const rows: unknown[][] = [];
  const approved = state.submissions.filter(s => s.status === "approved");
  if (kind === "marking") {
    rows.push(["Student", "Test / module title", "Test date", "Question", "Syllabus point / topic", "Marks", "Maximum marks", "Outcome (DONE/W/C/Blank)", "Evidence", "Marking explanation", "Tutor note", "Approved at", "Evidence reference"]);
    for (const row of generateExhibits(state).marking) rows.push([row.studentName, row.testTitle, row.date, row.questionId, row.topic, row.marks, row.maxMarks, row.outcome, row.evidence, row.reason, row.tutorNote, row.approvedAt, `${row.submissionId}:${row.questionId}`]);
  } else if (kind === "progress") {
    const exhibits = generateExhibits(state);
    rows.push(["Student", "Syllabus point / topic", "Approved question results", "Marks across recorded evidence", "Maximum marks across recorded evidence", "Observed mark percentage (not mastery)", "Evidence status", "Mastery", "DONE", "W", "C", "Blank", "Latest test date", "Evidence", "Suggested next steps", "Evidence references", "Scope"]);
    for (const row of exhibits.progress) rows.push([row.studentName, row.topic, row.evidenceCount, row.marks, row.maxMarks, row.percentage, row.evidenceStatus, row.mastery, row.outcomes.DONE, row.outcomes.W, row.outcomes.C, row.outcomes.Blank, row.latestDate, row.evidence.join("\n"), row.nextSteps.join("\n"), row.evidenceRefs.join("; "), exhibits.scope.progress]);
  } else if (kind === "exams") {
    const exhibits = generateExhibits(state);
    rows.push(["Student", "Test / module title", "Test date", "Score", "Maximum score", "Percentage", "Recorded attempt", "Total recorded attempts for this test", "Submission ID", "Approved at", "Scope"]);
    for (const row of exhibits.exams) rows.push([row.studentName, row.testTitle, row.date, row.score, row.maxScore, row.percentage, row.recordedAttempt, row.recordedAttempts, row.submissionId, row.approvedAt, exhibits.scope.exams]);
  } else if (kind === "daily") {
    rows.push(["Date", "Record type", "Student", "Count", "Details", "Evidence reference"]);
    for (const submission of approved.filter(s => s.approvedAt && calendarDate(s.approvedAt) === date)) rows.push([date, "paper_approved", submission.studentName, 1, state.tests.find(t => t.id === submission.testId)!.title, submission.id]);
    for (const activity of state.activities.filter(a => a.date === date)) rows.push([date, activity.type, activity.studentName, activity.count, activity.notes, activity.id]);
    for (const followup of state.followups.filter(f => f.dueDate === date)) rows.push([date, followup.done ? "followup_completed" : "followup_pending", followup.studentName, 1, followup.task, followup.id]);
  } else throw new WorkspaceError("Unknown export kind.");
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
