import assert from "node:assert/strict";
import test from "node:test";
import { approveMarking, calendarDate, csvCell, draftMarking, emptyWorkspace, exportWorkspaceCsv, generateBriefs, generateExhibits, makeActivity, makeChatSubmission, makeSavedBrief, makeSubmission, makeTest, validateDate, validateQuestionMarks, WorkspaceError } from "./domain.ts";
import { withoutDefaultGuides } from "./reference-materials.ts";

const now = "2026-10-12T22:00:00Z";
function fixture() {
  const rubric = makeTest({ title: "Centre checkpoint", rubricAttachmentNames: ["checkpoint-rubric.pdf"], markIncrement: 0.5, guideText: "Q1: f'(x)=2x, one mark for method and one for result. Q2: x=3, one mark.", questions: [{ id: "Q1", topic: "Differentiation", maxMarks: 2, criteria: "1 for method; 1 for 2x." }, { id: "Q2", topic: "Equations", maxMarks: 1, criteria: "x=3." }] }, "test-1", now);
  const state = { ...emptyWorkspace(), tests: [rubric] };
  const submission = makeSubmission(state, { testId: rubric.id, paperQuestionIds: ["Q1", "Q2"], studentName: "Student A", date: "2026-10-13", files: [{ id: "page-1", name: "paper.png", mimeType: "image/png", size: 100 }] }, "submission-1", now);
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
test("exports contain question evidence without inferring mastery or lifetime attempt numbers", () => {
  const state = approved();
  assert.ok(exportWorkspaceCsv(state, "marking").includes(marks[0].evidence));
  assert.ok(exportWorkspaceCsv(state, "progress").includes(marks[0].tutorNote));
  assert.ok(exportWorkspaceCsv(state, "exams").includes('"1","3","33.33"'));
  const brief = generateBriefs(state).student[0]; assert.ok(brief.evidence[0].includes("1/2"));
  assert.ok(!JSON.stringify(brief).includes("improved"));
});
test("exhibit datasets exclude drafts and awaiting work, including student names", () => {
  const draft = draftMarking(fixture(), "submission-1", marks, 0);
  for (const state of [fixture(), draft]) {
    const exhibits = generateExhibits(state);
    assert.deepEqual(exhibits.marking, []); assert.deepEqual(exhibits.progress, []); assert.deepEqual(exhibits.exams, []);
    assert.ok(!JSON.stringify(exhibits).includes("Student A"));
  }
});
test("Exhibit 1 preserves syllabus points and the brief's four outcome codes", () => {
  const state = fixture();
  state.tests[0].questions = ["correct", "wrong", "careless", "blank"].map((status, index) => ({ id: `Q${index + 1}`, topic: `8.${index + 1}`, maxMarks: 2, criteria: "Two marks for the supplied solution." }));
  state.submissions[0].questions = state.tests[0].questions.map((question, index) => ({ questionId: question.id, awardedMarks: index === 0 ? 2 : index === 3 ? 0 : 1, status: ["correct", "wrong", "careless", "blank"][index], evidence: `Page 1, ${question.id}: recorded working.`, reason: "Compared with supplied criteria.", tutorNote: "" }));
  state.submissions[0].paperQuestionIds = state.tests[0].questions.map(q => q.id);
  const exhibits = generateExhibits(approveMarking(state, "submission-1", 0, now));
  assert.deepEqual(exhibits.marking.map(row => row.outcome), ["DONE", "W", "C", "Blank"]);
  assert.deepEqual(exhibits.marking.map(row => row.topic), ["8.1", "8.2", "8.3", "8.4"]);
  const csv = exportWorkspaceCsv(approveMarking(state, "submission-1", 0, now), "marking");
  assert.ok(csv.includes('"Syllabus point / topic"')); assert.ok(csv.includes('"8.1","2","2","DONE"'));
});
test("Exhibit 2 aggregates approved question evidence by exact alias and topic without declaring mastery", () => {
  const state = approved();
  state.tests[0].questions[1].topic = "Differentiation";
  state.tests.push(makeTest({ title: "Another saved test", rubricAttachmentNames: ["geometry-rubric.pdf"], markIncrement: 1, guideText: "Supplied geometry solution.", questions: [{ id: "Q1", topic: "Geometry", maxMarks: 1, criteria: "One mark for the supplied answer." }] }, "test-2", now));
  const extra = { ...state.submissions[0], id: "submission-2", date: "2026-10-14", createdAt: "2026-10-13T23:00:00Z", questions: state.submissions[0].questions.map(q => ({ ...q, awardedMarks: q.questionId === "Q1" ? 2 : 1, status: "correct" })) };
  state.submissions.unshift(extra);
  state.submissions.push({ ...extra, id: "draft-private", studentName: "Unapproved student", status: "draft" });
  const before = state.submissions.map(row => row.id);
  const result = generateExhibits(state);
  assert.deepEqual(state.submissions.map(row => row.id), before, "Generating records must not reorder workspace data");
  assert.equal(result.progress.length, 2);
  const topic = result.progress.find(row => row.topic === "Differentiation");
  assert.equal(topic.evidenceCount, 4); assert.equal(topic.marks, 4); assert.equal(topic.maxMarks, 6); assert.equal(topic.percentage, 66.67);
  assert.equal(topic.mastery, "Tutor confirmation needed"); assert.equal(topic.evidenceStatus, "Approved evidence");
  assert.equal(topic.latestDate, "2026-10-14"); assert.deepEqual(topic.outcomes, { DONE: 2, W: 1, C: 0, Blank: 1 });
  assert.ok(topic.nextSteps.includes(marks[0].tutorNote)); assert.equal(topic.evidenceRefs.length, 4);
  const noEvidence = result.progress.find(row => row.topic === "Geometry");
  assert.equal(noEvidence.percentage, null); assert.equal(noEvidence.evidenceStatus, "No approved evidence");
  assert.equal(noEvidence.mastery, "Tutor confirmation needed"); assert.equal(noEvidence.latestDate, null);
  assert.deepEqual(noEvidence.evidenceRefs, []); assert.deepEqual(noEvidence.nextSteps, []);
  assert.match(result.scope.progress, /saved tests only/); assert.match(result.scope.progress, /not course coverage or mastery/);
  assert.ok(!JSON.stringify(result.progress).includes("not yet covered"));
  assert.ok(!JSON.stringify(result).includes("Unapproved student"));
});
test("Exhibit 3 numbers only recorded approved attempts for the same student and saved test", () => {
  const state = approved();
  const first = state.submissions[0];
  const later = { ...first, id: "later", date: "2026-10-15", createdAt: "2026-10-15T01:00:00Z" };
  const earlier = { ...first, id: "earlier", date: "2026-10-11", createdAt: "2026-10-16T01:00:00Z" };
  state.tests.push({ ...state.tests[0], id: "different-test" });
  state.submissions = [later, { ...earlier, id: "unapproved", status: "draft" }, first, earlier, { ...later, id: "different-student", studentName: "Student B" }, { ...later, id: "different-test-submission", testId: "different-test" }];
  const result = generateExhibits(state);
  const group = result.exams.filter(row => row.studentName === "Student A" && row.testId === "test-1");
  assert.deepEqual(group.map(row => [row.submissionId, row.recordedAttempt, row.recordedAttempts]), [["earlier", 1, 3], ["submission-1", 2, 3], ["later", 3, 3]]);
  assert.equal(result.exams.find(row => row.studentName === "Student B").recordedAttempts, 1);
  assert.equal(result.exams.find(row => row.testId === "different-test").recordedAttempts, 1);
  assert.equal(group[0].percentage, 33.33); assert.equal(group[0].testTitle, state.tests[0].title);
  assert.ok(!("pass" in group[0])); assert.ok(!("className" in group[0])); assert.ok(!("lifetimeAttempt" in group[0]));
  assert.match(result.scope.exams, /do not establish lifetime attempt history/);
  assert.match(exportWorkspaceCsv(state, "exams"), /Recorded attempt/);
});
test("whole-mark guides reject half-mark maxima and half-mark scoring", () => {
  const input = { title: "Whole marks", rubricAttachmentNames: ["whole-marks-rubric.pdf"], guideText: "Supplied whole-mark criteria.", markIncrement: 1, questions: [{ id: "Q1", topic: "Equations", maxMarks: 2, criteria: "One mark per completed step." }] };
  const rubric = makeTest(input, "whole", now);
  assert.equal(rubric.markIncrement, 1);
  assert.throws(() => makeTest({ ...input, questions: [{ ...input.questions[0], maxMarks: 1.5 }] }, "whole", now), /1-mark increments/);
  assert.throws(() => validateQuestionMarks(rubric, [{ ...marks[0], awardedMarks: 0.5 }]), /1-mark increments/);
  assert.equal(validateQuestionMarks(rubric, [marks[0]], true)[0].awardedMarks, 1);
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
  const state = fixture(); const input = { testId: "test-1", paperQuestionIds: ["Q1", "Q2"], studentName: "Student A", date: "2026-10-13", chatAttachmentNames: ["page-1.png", "page-2.png"] };
  const result = makeChatSubmission(state, input, "chat-1", now);
  assert.equal(result.inputSource, "chat"); assert.equal(result.status, "awaiting_marking"); assert.deepEqual(result.files, []); assert.deepEqual(result.chatAttachmentNames, input.chatAttachmentNames);
  assert.throws(() => makeChatSubmission(state, { ...input, chatAttachmentNames: [] }, "chat-1", now), /attachment names/);
  assert.throws(() => makeChatSubmission(state, { ...input, chatAttachmentNames: ["same.png", "same.png"] }, "chat-1", now), /unique/);
  assert.throws(() => makeChatSubmission(state, { ...input, testId: "missing" }, "chat-1", now), /not found/);
});
test("new tests require an uploaded rubric and its explicit scoring increment", () => {
  const input = fixture().tests[0];
  for (const rubricAttachmentNames of [undefined, [], [" "], ["rubric.pdf", "rubric.pdf"]]) {
    assert.throws(() => makeTest({ ...input, rubricAttachmentNames }, "new", now), /rubric|Rubric/);
  }
  assert.throws(() => makeTest({ ...input, markIncrement: undefined }, "new", now), /No default mark increment/);
  assert.deepEqual(makeTest(input, "new", now).rubricAttachmentNames, ["checkpoint-rubric.pdf"]);
});
test("a nine-question paper cannot be registered against a three-question rubric", () => {
  const questions = Array.from({ length: 9 }, (_, index) => ({ id: `Q${index + 1}`, topic: `Topic ${index + 1}`, maxMarks: 1, criteria: `Uploaded criterion ${index + 1}.` }));
  const rubric = makeTest({ title: "Uploaded complete paper", guideText: "Uploaded criteria for the supplied questions.", rubricAttachmentNames: ["uploaded-rubric.pdf"], markIncrement: 1, questions: questions.slice(0, 3) }, "short-guide", now);
  const state = { ...emptyWorkspace(), tests: [rubric] };
  const input = { testId: rubric.id, studentName: "Student A", date: "2026-10-13", paperQuestionIds: questions.map(q => q.id), chatAttachmentNames: ["complete-nine-question-paper.pdf"] };
  assert.throws(() => makeChatSubmission(state, input, "paper", now), /Missing from rubric: Q4, Q5, Q6, Q7, Q8, Q9/);
  assert.throws(() => makeSubmission(state, { ...input, files: fixture().submissions[0].files }, "paper", now), /complete paper/);
  state.tests[0] = makeTest({ ...rubric, questions }, rubric.id, now);
  const complete = makeChatSubmission(state, input, "paper", now);
  assert.equal(complete.questions.length, 9); assert.deepEqual(complete.paperQuestionIds, input.paperQuestionIds);
  state.submissions = [complete];
  const incompleteMarks = questions.slice(0, 3).map(q => ({ questionId: q.id, awardedMarks: 0, status: "blank", evidence: "No answer on uploaded paper.", reason: "Not attempted.", tutorNote: "" }));
  assert.throws(() => draftMarking(state, complete.id, incompleteMarks, 0), /every question/);
});
test("paper coverage rejects missing, duplicate and extra question or subpart IDs", () => {
  const state = fixture();
  const input = { testId: "test-1", studentName: "Student A", date: "2026-10-13", chatAttachmentNames: ["paper.pdf"] };
  for (const paperQuestionIds of [undefined, [], ["Q1", "Q1"], ["Q1"], ["Q1", "Q2", "Q3"]]) {
    assert.throws(() => makeChatSubmission(state, { ...input, paperQuestionIds }, "paper", now), /paper|Paper/);
  }
  assert.deepEqual(makeChatSubmission(state, { ...input, paperQuestionIds: ["Q2", "Q1"] }, "paper", now).paperQuestionIds, ["Q2", "Q1"]);
  state.tests[0].questions[0].id = "Q1a";
  assert.throws(() => makeChatSubmission(state, { ...input, paperQuestionIds: ["Q1", "Q2"] }, "paper", now), /Q1a/);
  delete state.tests[0].rubricAttachmentNames;
  assert.throws(() => makeChatSubmission(state, { ...input, paperQuestionIds: ["Q1a", "Q2"] }, "paper", now), /Upload the marking rubric/);
});
test("historical drafts without uploaded rubric provenance or full-paper coverage must restart", () => {
  for (const missing of ["rubric", "coverage"]) {
    const state = draftMarking(fixture(), "submission-1", marks, 0);
    if (missing === "rubric") delete state.tests[0].rubricAttachmentNames;
    else delete state.submissions[0].paperQuestionIds;
    assert.throws(() => approveMarking(state, "submission-1", 1, now), /start a new marking workflow/);
    assert.throws(() => draftMarking(state, "submission-1", marks, 1), /start a new marking workflow/);
  }
});
test("fresh workspaces have no default rubric and historical referenced records remain intact", () => {
  assert.deepEqual(withoutDefaultGuides(emptyWorkspace()), emptyWorkspace());
  const state = approved();
  state.tests[0].id = "vcaa-2026-nht-methods1-q1-3";
  state.submissions[0].testId = state.tests[0].id;
  delete state.tests[0].rubricAttachmentNames;
  delete state.submissions[0].paperQuestionIds;
  const before = structuredClone(state);
  const preserved = withoutDefaultGuides(state);
  assert.deepEqual(preserved, before);
  assert.equal(generateExhibits(preserved).exams[0].score, 1);
  assert.equal(generateBriefs(preserved).student.length, 1);
  assert.ok(exportWorkspaceCsv(preserved, "marking").includes(marks[0].evidence));
  const unreferenced = withoutDefaultGuides({ ...emptyWorkspace(), tests: before.tests });
  assert.deepEqual(unreferenced.tests, []);
  const uploaded = fixture().tests[0];
  assert.deepEqual(withoutDefaultGuides({ ...emptyWorkspace(), tests: [uploaded] }).tests, [uploaded]);
});
