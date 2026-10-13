import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { unzipSync, strFromU8 } from "fflate";
import { approveMarking, draftMarking, emptyWorkspace, makeChatSubmission, makeSavedBrief, makeTest } from "./domain.ts";

// Bundle the exact Blob export used by the Worker, with no DOM or Web Worker present.
const bundled = await build({ stdin: { contents: 'export * from "./lib/report-exports"; export * from "./lib/report-feedback";', resolveDir: process.cwd() }, bundle: true, platform: "browser", format: "esm", write: false });
const { exportExhibitsWorkbook, exportFeedbackHtml, getFreshFeedback } = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].contents).toString("base64"));
const now = "2026-10-13T04:00:00Z";
const date = "2026-10-13";
const alias = '=HYPERLINK("https://example.invalid","A")';

function fixture() {
  const rubric = makeTest({ rubricAttachmentNames: ["rubric.pdf"], markIncrement: 1, title: "Module <8>", guideText: "Two points for each question.", questions: [{ id: "1", topic: "8.1", maxMarks: 2, criteria: "Two criteria." }, { id: "2", topic: "8.2", maxMarks: 2, criteria: "Two criteria." }] }, "test-1", now);
  let state = { ...emptyWorkspace(), tests: [rubric] };
  const submission = makeChatSubmission(state, { testId: rubric.id, studentName: alias, date, chatAttachmentNames: ["paper.png"], paperQuestionIds: ["1", "2"] }, "paper-1", now);
  const other = makeChatSubmission(state, { testId: rubric.id, studentName: "Draft student must not appear", date, chatAttachmentNames: ["draft.png"], paperQuestionIds: ["1", "2"] }, "paper-draft", now);
  state = { ...state, submissions: [submission, other] };
  state = draftMarking(state, submission.id, [{ questionId: "1", awardedMarks: 2, status: "correct", evidence: "<script>alert(1)</script>", reason: "+Not a formula", tutorNote: "Keep showing the method." }, { questionId: "2", awardedMarks: 0, status: "blank", evidence: "Empty answer space.", reason: "Not attempted.", tutorNote: "Try this next." }], 0);
  return approveMarking(state, submission.id, 1, now);
}
function withFeedback(state = fixture()) {
  const briefs = ["student", "parent", "manager"].map((audience, index) => makeSavedBrief(state, { audience, date, ...(audience === "manager" ? {} : { submissionId: "paper-1" }), text: `${audience}: <img src=x onerror=alert(1)> Only saved feedback.`, evidenceRefs: ["paper-1:1", "paper-1:2"], sourceRevisions: { "paper-1": 2 } }, `brief-${index}`, now));
  return { ...state, briefs };
}

test("three-sheet workbook contains approved scopes, explicit string cells and requested outcome colours", async () => {
  const file = await exportExhibitsWorkbook(fixture(), "paper-1");
  const parts = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const xml = Object.fromEntries(Object.entries(parts).map(([name, bytes]) => [name, strFromU8(bytes)]));
  assert.match(xml["[Content_Types].xml"], /spreadsheetml/);
  for (const [number, name] of [[1, "Marking"], [2, "Progress"], [3, "Exams"]]) {
    assert.match(xml["xl/workbook.xml"], new RegExp(`Exhibit ${number} — ${name}`));
    assert.ok(xml[`xl/worksheets/sheet${number}.xml`]);
  }
  const allXml = Object.values(xml).join("\n");
  assert.ok(!allXml.includes("Draft student must not appear"));
  assert.ok(!allXml.includes("paper-draft"));
  assert.ok(allXml.includes("HYPERLINK"));
  assert.ok(!/<f(?:\s|>)/.test(allXml), "user data must not become spreadsheet formulas");
  assert.match(allXml, /Mastery unconfirmed/);
  assert.match(allXml, /course coverage and mastery percentages are unavailable/);
  assert.match(xml["xl/styles.xml"], /D9EEDC/);
  assert.match(xml["xl/styles.xml"], /48515C/);
  assert.match(xml["xl/styles.xml"], /FFF0B3/); // 50% exam result is yellow.
});

test("workbook refuses a missing or unapproved selected result", async () => {
  await assert.rejects(() => exportExhibitsWorkbook(fixture(), ""), /Select an approved/);
  await assert.rejects(() => exportExhibitsWorkbook(fixture(), "missing"), /not found/);
  await assert.rejects(() => exportExhibitsWorkbook(fixture(), "paper-draft"), /Approve/);
});

test("large complete papers export without browser Web Workers", async () => {
  const state = fixture();
  const questions = Array.from({ length: 60 }, (_, index) => ({ id: String(index + 1), topic: `Topic ${index + 1}`, maxMarks: 2, criteria: "Two criteria." }));
  state.tests[0] = { ...state.tests[0], questions };
  state.submissions[0] = { ...state.submissions[0], paperQuestionIds: questions.map(q => q.id), questions: questions.map(q => ({ questionId: q.id, awardedMarks: 2, status: "correct", evidence: `Q${q.id}: ` + "Observed student working. ".repeat(230), reason: "Both criteria shown.", tutorNote: "Next practice." })) };
  const file = await exportExhibitsWorkbook(state, "paper-1");
  const parts = unzipSync(new Uint8Array(await file.arrayBuffer()));
  assert.ok(parts["xl/sharedStrings.xml"].length > 160_000);
  assert.match(strFromU8(parts["xl/sharedStrings.xml"]), /Topic 60/);
});

test("feedback requires all three current saved drafts and escapes supplied content", () => {
  assert.throws(() => exportFeedbackHtml(fixture(), "paper-1"), /still preparing/);
  const state = withFeedback();
  assert.equal(getFreshFeedback(state, "paper-1").complete, true);
  const output = exportFeedbackHtml(state, "paper-1");
  for (const section of ["Student feedback", "Parent talking points", "Manager summary"]) assert.ok(output.includes(section));
  assert.ok(output.includes("Only saved feedback."));
  assert.ok(output.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(output.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(!output.includes("<script>"));
  assert.ok(!output.includes("<img "));
});

test("freshness rejects mismatched revisions, deleted sources and additional uncited daily work", () => {
  const state = withFeedback();
  const stale = { ...state, briefs: state.briefs.map(brief => brief.audience === "parent" ? { ...brief, sourceRevisions: { "paper-1": 1 } } : brief) };
  assert.equal(getFreshFeedback(stale, "paper-1").complete, false);
  assert.throws(() => exportFeedbackHtml(stale, "paper-1"), /still preparing/);
  const invalid = { ...state, briefs: state.briefs.map(brief => ({ ...brief, evidenceRefs: ["deleted-source"] })) };
  assert.equal(getFreshFeedback(invalid, "paper-1").complete, false);
  const addedPaper = { ...state, submissions: [...state.submissions, { ...state.submissions[0], id: "paper-2" }] };
  assert.equal(getFreshFeedback(addedPaper, "paper-1").manager, undefined);
  const addedActivity = { ...state, activities: [{ id: "activity-1", date, type: "qa", studentName: alias, count: 1, notes: "Explained Q2." }] };
  assert.equal(getFreshFeedback(addedActivity, "paper-1").manager, undefined);
  assert.equal(getFreshFeedback(state, "paper-1", "2026-10-14").complete, false);
});
