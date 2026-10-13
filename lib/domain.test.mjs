import assert from "node:assert/strict";
import test from "node:test";
import { approveMarking, calendarDate, csvCell, draftMarking, emptyWorkspace, exportWorkspaceCsv, generateBriefs, makeActivity, makeChatSubmission, makeSavedBrief, makeSubmission, makeTest, validateDate, validateQuestionMarks, WorkspaceError } from "./domain.ts";

const now = "2026-10-12T22:00:00Z";
function fixture() {
  const rubric = makeTest({ title: "Centre checkpoint", guideText: "Q1: f'(x)=2x, one mark for method and one for result. Q2: x=3, one mark.", questions: [{ id: "Q1", topic: "Differentiation", maxMarks: 2, criteria: "1 for method; 1 for 2x." }, { id: "Q2", topic: "Equations", maxMarks: 1, criteria: "x=3." }] }, "test-1", now);
  const state = { ...emptyWorkspace(), tests: [rubric] };
  const submission = makeSubmission(state, { testId: rubric.id, studentName: "Student A", date: "2026-10-13", files: [{ id: "page-1", name: "paper.png", mimeType: "image/png", size: 100 }] }, "submission-1", now);
  return { ...state, submissions: [submission] };
}
const marks = [{ questionId: "Q1", awardedMarks: 1, status: "wrong", evidence: "Page 1, Q1: power rule written; coefficient omitted.", reason: "Method mark awarded; correct derivative absent.", tutorNote: "Practise multiplying by the original exponent." }, { questionId: "Q2", awardedMarks: 0, status: "blank", evidence: "Page 1, Q2: empty answer space.", reason: "Not attempted.", tutorNote: "" }];
function approved() { return approveMarking(draftMarking(fixture(), "submission-1", marks, 0), "submission-1", 1, now); }

test("partial credit survives tutor approval with exact source evidence", () => {
  const state = approved(); const submission = state.submissions[0];
  assert.equal(submission.status, "approved"); assert.equal(submission.revision, 2); assert.equal(submission.approvedAt, now);
  assert.equal(submission.questions[0].awardedMarks, 1); assert.equal(submission.questions[0].evidence, marks[0].evidence);
  assert.equal(generateBriefs(state, "2026-10-13").student[0].score, 1);
});
test("unresolved, null and unsupported marks cannot be approved", () => {
  assert.throws(() => approveMarking(fixture(), "submission-1", 0, now), /Resolve/);
  const pending = draftMarking(fixture(), "submission-1", [{ ...marks[0], status: "review" }, marks[1]], 0);
  assert.throws(() => approveMarking(pending, "submission-1", 1, now), /Resolve/);
  const missingEvidence = draftMarking(fixture(), "submission-1", [{ ...marks[0], evidence: "" }, marks[1]], 0);
  assert.throws(() => approveMarking(missingEvidence, "submission-1", 1, now), /evidence and an explanation/);
  const missingReason = draftMarking(fixture(), "submission-1", [{ ...marks[0], reason: "" }, marks[1]], 0);
  assert.throws(() => approveMarking(missingReason, "submission-1", 1, now), /evidence and an explanation/);
});
test("draft edits and approvals reject stale revisions and preserve immutable approved evidence", () => {
  const draft = draftMarking(fixture(), "submission-1", marks, 0);
  assert.throws(() => draftMarking(draft, "submission-1", marks, 0), error => error instanceof WorkspaceError && error.status === 409);
  assert.throws(() => approveMarking(draft, "submission-1", 0, now), /changed in another window/);
  assert.throws(() => draftMarking(approved(), "submission-1", marks, 2), /Approved marking is locked/);
});
test("rubric validation rejects missing, extra, duplicate questions, invalid statuses and out of range marks", () => {
  const rubric = fixture().tests[0];
  for (const value of [marks.slice(0, 1), [...marks, marks[0]], [marks[0], marks[0]], [{ ...marks[0], questionId: "Q99" }, marks[1]], [{ ...marks[0], status: "excellent" }, marks[1]], [{ ...marks[0], awardedMarks: 3 }, marks[1]], [{ ...marks[0], awardedMarks: -1 }, marks[1]], [{ ...marks[0], awardedMarks: 0.25 }, marks[1]], [{ ...marks[0], awardedMarks: undefined }, marks[1]], [{ ...marks[0], awardedMarks: NaN }, marks[1]]]) assert.throws(() => validateQuestionMarks(rubric, value));
  assert.throws(() => validateQuestionMarks(rubric, [marks[0], { ...marks[1], awardedMarks: 1 }]), /must receive 0/);
  assert.throws(() => validateQuestionMarks(rubric, [{ ...marks[0], status: "correct" }, marks[1]]), /must receive full/);
});
test("unapproved submissions never appear in exports or conversation evidence", () => {
  const state = draftMarking(fixture(), "submission-1", marks, 0);
  assert.deepEqual(generateBriefs(state).student, []);
  for (const kind of ["marking", "progress", "exams", "daily"]) {
    const csv = exportWorkspaceCsv(state, kind, "2026-10-13");
    assert.ok(!csv.includes("Student A")); assert.ok(!csv.includes(marks[0].evidence));
  }
});
test("exports contain question evidence without inferring mastery or attempt numbers", () => {
  const state = approved();
  assert.ok(exportWorkspaceCsv(state, "marking").includes(marks[0].evidence));
  assert.ok(exportWorkspaceCsv(state, "progress").includes(marks[0].tutorNote));
  assert.ok(exportWorkspaceCsv(state, "exams").includes('"1","3","33.33"'));
  const brief = generateBriefs(state).student[0]; assert.ok(brief.evidence[0].includes("1/2"));
  assert.ok(!JSON.stringify(brief).includes("improved"));
});
test("CSV neutralises formula prefixes, whitespace, newlines and quotes", () => {
  for (const value of ["=1+1", "+SUM(A1)", "-1+2", "@SUM(A1)", "  =1+1", "\t=1+1", "\rabc", "\nabc"]) assert.ok(csvCell(value).startsWith('"\''));
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  const state = approved(); state.submissions[0].studentName = "=HYPERLINK(\"bad\")";
  assert.ok(exportWorkspaceCsv(state, "exams").includes('"\'=HYPERLINK'));
});
test("daily manager counts are approval-date based in Melbourne and include only explicitly logged activity", () => {
  const state = approved();
  state.activities = [makeActivity({ date: "2026-10-13", type: "qa", studentName: "Student A", count: 2, notes: "Reviewed derivatives." }, "activity-1"), makeActivity({ date: "2026-10-12", type: "parent_contact", studentName: "Student A", count: 1, notes: "Old contact." }, "activity-2")];
  state.followups = [{ id: "f1", studentName: "Student A", task: "Practise derivatives", dueDate: "2026-10-13", done: false }];
  const report = generateBriefs(state, "2026-10-13").manager;
  assert.equal(report.papersMarked, 1); assert.equal(report.marksReviewed, 2); assert.equal(report.activities.qa, 2); assert.equal(report.activities.parent_contact, 0); assert.equal(report.followups.length, 1);
  assert.equal(generateBriefs(state, "2026-10-12").manager.papersMarked, 0);
  const csv = exportWorkspaceCsv(state, "daily", "2026-10-13"); assert.ok(csv.includes("Reviewed derivatives")); assert.ok(!csv.includes("Old contact"));
  assert.equal(calendarDate(now), "2026-10-13");
});
test("dates and activity counts reject malformed input", () => {
  for (const value of ["2026-02-30", "2026-13-01", "2026-1-1", "no date", null]) assert.throws(() => validateDate(value));
  for (const count of [0, -1, 0.5, "2", 101]) assert.throws(() => makeActivity({ date: "2026-10-13", type: "qa", count }, "activity"));
  assert.throws(() => makeActivity({ date: "2026-10-13", type: "unrecorded", count: 1 }, "activity"));
});
test("saved conversation briefs require approved evidence and exact source revision", () => {
  const state = approved(); const input = { audience: "parent", submissionId: "submission-1", date: "2026-10-13", text: "Q1 received one of two marks; practise the final derivative.", evidenceRefs: ["submission-1:Q1"], sourceRevisions: { "submission-1": 2 } };
  assert.equal(makeSavedBrief(state, input, "brief1", now).text, input.text);
  assert.throws(() => makeSavedBrief(fixture(), input, "brief1", now), /approved/);
  assert.throws(() => makeSavedBrief(state, { ...input, sourceRevisions: { "submission-1": 1 } }, "brief1", now), /changed/);
  assert.throws(() => makeSavedBrief(state, { ...input, evidenceRefs: ["submission-1:Q99"] }, "brief1", now), /Evidence/);
  assert.throws(() => makeSavedBrief(state, { ...input, sourceRevisions: { "submission-1": 2, arbitrary: 1 } }, "brief1", now), /sourceRevisions/);
});
test("activity evidence is limited to manager briefs on the activity date", () => {
  const state = approved(); state.activities = [makeActivity({ date: "2026-10-13", type: "qa", count: 1, notes: "Review recorded." }, "activity-1")];
  const input = { audience: "manager", date: "2026-10-13", text: "One Q&A activity recorded.", evidenceRefs: ["activity-1"], sourceRevisions: {} };
  assert.equal(makeSavedBrief(state, input, "brief1", now).evidenceRefs[0], "activity-1");
  assert.throws(() => makeSavedBrief(state, { ...input, date: "2026-10-12" }, "brief1", now), /Evidence/);
  assert.throws(() => makeSavedBrief(state, { ...input, audience: "student", submissionId: "submission-1" }, "brief1", now), /selected approved submission only/);
});
test("chat submissions record filenames without claiming to archive conversation attachments", () => {
  const state = fixture(); const input = { testId: "test-1", studentName: "Student A", date: "2026-10-13", chatAttachmentNames: ["page-1.png", "page-2.png"] };
  const result = makeChatSubmission(state, input, "chat-1", now);
  assert.equal(result.inputSource, "chat"); assert.equal(result.status, "awaiting_marking"); assert.deepEqual(result.files, []); assert.deepEqual(result.chatAttachmentNames, input.chatAttachmentNames);
  assert.throws(() => makeChatSubmission(state, { ...input, chatAttachmentNames: [] }, "chat-1", now), /attachment names/);
  assert.throws(() => makeChatSubmission(state, { ...input, chatAttachmentNames: ["same.png", "same.png"] }, "chat-1", now), /unique/);
  assert.throws(() => makeChatSubmission(state, { ...input, testId: "missing" }, "chat-1", now), /not found/);
});
