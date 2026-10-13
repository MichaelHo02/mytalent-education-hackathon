import writeXlsxFile, { type Cell, type Row, type SheetData } from "write-excel-file";
type CellObject = NonNullable<Cell>;
import { findSubmission, generateExhibits, WorkspaceError } from "./domain";
import { getFreshFeedback } from "./report-feedback";
import type { ExhibitOutcome, WorkspaceState } from "./types";

const palette = { navy: "#16324F", gold: "#BA8929", green: "#D9EEDC", red: "#F8D7DA", yellow: "#FFF0B3", dark: "#48515C", blue: "#E5EFF9", muted: "#667085", border: "#D8DEE7" };
const outcomes: Record<ExhibitOutcome, string> = { DONE: palette.green, W: palette.red, C: palette.yellow, Blank: palette.dark };
const border = { borderColor: palette.border, borderStyle: "thin" as const };
function cell(value: string | number, style: Partial<CellObject> = {}): CellObject {
  // Explicit String cells preserve names/evidence literally, including leading '=' or '+'.
  const display = typeof value === "string" && value.length > 32700 ? value.slice(0, 32600) + "\n[Cell shortened to Excel's limit; full evidence remains in the workspace.]" : value;
  return { value: display, type: typeof value === "number" ? Number : String, wrap: true, alignVertical: "top", ...style };
}
function merged(value: string, columns: number, style: Partial<CellObject> = {}): Row {
  return [cell(value, { span: columns, ...style }), ...Array(columns - 1).fill(null)];
}
function heading(labels: string[]): Row { return labels.map(label => cell(label, { backgroundColor: palette.navy, color: "#FFFFFF", fontWeight: "bold", height: 36, ...border })); }
function title(value: string, columns: number): Row { return merged(value, columns, { color: palette.navy, fontSize: 20, fontWeight: "bold", height: 34 }); }
function note(value: string, columns: number, height = 40): Row { return merged(value, columns, { color: palette.muted, height }); }
function approvedSelection(state: WorkspaceState, submissionId: string) {
  if (!submissionId) throw new WorkspaceError("Select an approved result to export.");
  const selected = findSubmission(state, submissionId);
  if (selected.status !== "approved") throw new WorkspaceError("Approve the marking before exporting final records.", 409);
  const test = state.tests.find(item => item.id === selected.testId);
  if (!test) throw new WorkspaceError("This approved result is missing its marking guide.", 409);
  return { selected, test };
}

/** A real three-sheet XLSX. Scope is explicit: selected paper, student evidence, workspace attempts. */
export async function exportExhibitsWorkbook(state: WorkspaceState, submissionId: string): Promise<Blob> {
  const { selected, test } = approvedSelection(state, submissionId);
  const exhibits = generateExhibits(state);
  const paper = exhibits.marking.filter(row => row.submissionId === selected.id);
  const progress = exhibits.progress.filter(row => row.studentName === selected.studentName);
  const score = paper.reduce((sum, row) => sum + row.marks, 0);
  const maximum = paper.reduce((sum, row) => sum + row.maxMarks, 0);
  const marking: SheetData = [
    title("EXHIBIT 1  ·  Marking Sheet", 9),
    merged(`${selected.studentName}  ·  ${test.title}  ·  ${selected.date}`, 9, { fontWeight: "bold", height: 32 }),
    note(`Tutor-approved: ${score}/${maximum} marks. DONE = correct · W = wrong · C = careless error · Blank = not attempted.`, 9),
    heading(["Question", "Syllabus point / topic", "Marks", "Maximum", "Outcome", "Student evidence", "Marking explanation", "Tutor feedback", "Evidence reference"]),
    ...paper.map(row => [cell(row.questionId, border), cell(row.topic, border), cell(row.marks, border), cell(row.maxMarks, border), cell(row.outcome, { ...border, backgroundColor: outcomes[row.outcome], color: row.outcome === "Blank" ? "#FFFFFF" : palette.navy, fontWeight: "bold", align: "center" }), cell(row.evidence, border), cell(row.reason, border), cell(row.tutorNote, border), cell(`${row.submissionId}:${row.questionId}`, border)]),
    [], note(`Approved at ${selected.approvedAt ?? "recorded approval"} · source revision ${selected.revision}.`, 9),
  ];

  const covered = progress.filter(row => row.evidenceCount > 0).length;
  const progressData: SheetData = [
    title("EXHIBIT 2  ·  Student Progress Sheet", 6),
    merged(selected.studentName, 6, { fontWeight: "bold", height: 28 }),
    note("Evidence map of saved topics. Blue = approved question evidence; grey = no approved evidence. Mastery is not assessed by these colours.", 6, 50),
    note(`${covered} of ${progress.length} saved topics have approved evidence. A complete course catalogue has not been supplied; course coverage and mastery percentages are unavailable.`, 6, 50),
  ];
  for (let offset = 0; offset < progress.length; offset += 6) {
    progressData.push(Array.from({ length: 6 }, (_, index) => {
      const row = progress[offset + index];
      if (!row) return null;
      return cell(`${row.topic}\n${row.evidenceCount ? `${row.marks}/${row.maxMarks} marks (${row.percentage}%)\n${row.evidenceCount} approved result(s)` : "No approved evidence"}\nMastery unconfirmed`, { ...border, backgroundColor: row.evidenceCount ? palette.blue : palette.dark, color: row.evidenceCount ? palette.navy : "#FFFFFF", height: 96, align: "center", alignVertical: "center" });
    }));
  }
  progressData.push([], heading(["Syllabus point / topic", "Approved results", "Observed mark percentage", "Mastery", "Evidence", "Next practice"]));
  progressData.push(...progress.map(row => [cell(row.topic, border), cell(row.evidenceCount, border), row.percentage === null ? cell("No approved evidence", border) : cell(row.percentage / 100, { ...border, format: "0.0%" }), cell(row.mastery, border), cell(row.evidence.map((evidence, index) => `${evidence}\nRef: ${row.evidenceRefs[index]}`).join("\n"), border), cell(row.nextSteps.join("\n"), border)]));
  progressData.push([], note(exhibits.scope.progress, 6, 70));

  const columns = [...new Map(exhibits.exams.map(row => [JSON.stringify([row.testId, row.recordedAttempt]), { testId: row.testId, title: row.testTitle, attempt: row.recordedAttempt }])).values()];
  const students = [...new Set(exhibits.exams.map(row => row.studentName))];
  const examWidth = Math.max(columns.length + 1, 8);
  const exams: SheetData = [
    title("EXHIBIT 3  ·  Student Exam Statistics", examWidth),
    note("All tutor-approved attempts recorded in this workspace. Student aliases are grouped exactly as saved; no class roster or unrecorded attempts are inferred.", examWidth, 46),
    note("Performance bands: green ≥75% · yellow ≥40% and <75% · red <40%. — = no approved attempt recorded (not a claim of non-submission).", examWidth, 42),
    heading(["Student", ...columns.map(column => `${column.title}\nRecorded attempt ${column.attempt}`)]),
    ...students.map(student => [cell(student, { ...border, fontWeight: "bold" }), ...columns.map(column => {
      const row = exhibits.exams.find(item => item.studentName === student && item.testId === column.testId && item.recordedAttempt === column.attempt);
      return row ? cell(row.percentage / 100, { ...border, format: "0.0%", align: "center", backgroundColor: row.percentage >= 75 ? palette.green : row.percentage >= 40 ? palette.yellow : palette.red }) : cell("—", { ...border, backgroundColor: "#F2F4F7", align: "center" });
    })]),
    [], heading(["Student", "Test / module", "Test date", "Score", "Maximum", "Percentage", "Recorded attempt", "Evidence reference"]),
    ...exhibits.exams.map(row => [cell(row.studentName, border), cell(row.testTitle, border), cell(row.date, border), cell(row.score, border), cell(row.maxScore, border), cell(row.percentage / 100, { ...border, format: "0.0%" }), cell(row.recordedAttempt, border), cell(row.submissionId, border)]),
    [], note(exhibits.scope.exams, examWidth, 65),
  ];
  // This Blob writer uses in-process compression, including for large papers.
  // The newer worker-based writer requires browser Web Workers, unavailable in Sites.
  return writeXlsxFile([marking, progressData, exams], {
    sheets: ["Exhibit 1 — Marking", "Exhibit 2 — Progress", "Exhibit 3 — Exams"],
    columns: [
      [12, 28, 10, 10, 12, 48, 48, 42, 42].map(width => ({ width })),
      [28, 22, 24, 26, 52, 45].map(width => ({ width })),
      Array.from({ length: examWidth }, (_, index) => ({ width: index === 0 ? 28 : index === 1 || index === 7 ? 42 : 23 })),
    ],
    showGridLines: false, orientation: "landscape", fontFamily: "Calibri", fontSize: 11,
  });
}

function html(value: unknown): string { return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!); }

/** Export only the already-saved Codex feedback; this function never manufactures a narrative. */
export function exportFeedbackHtml(state: WorkspaceState, submissionId: string, date?: string): string {
  const { selected, test } = approvedSelection(state, submissionId);
  const feedback = getFreshFeedback(state, submissionId, date);
  if (!feedback.complete) throw new WorkspaceError("Codex is still preparing the current student, parent and manager feedback. Try again when all three drafts are ready.", 409);
  const rows = generateExhibits(state).marking.filter(row => row.submissionId === selected.id);
  const score = rows.reduce((sum, row) => sum + row.marks, 0);
  const maximum = rows.reduce((sum, row) => sum + row.maxMarks, 0);
  const sections = (["student", "parent", "manager"] as const).map(audience => {
    const brief = feedback[audience]!;
    const title = { student: "Student feedback", parent: "Parent talking points", manager: "Manager summary" }[audience];
    return `<section><h2>${title}</h2><div class="narrative">${html(brief.text)}</div><details><summary>Source evidence · ${brief.evidenceRefs.length} references</summary><p>${brief.evidenceRefs.map(html).join("<br>")}</p><p>Saved source revisions: ${html(JSON.stringify(brief.sourceRevisions))}</p></details></section>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${html(selected.studentName)} — MyTalent feedback</title><style>
    *{box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;margin:0;color:#182b43;background:#f5f6f8;line-height:1.6}main{max-width:900px;margin:32px auto;padding:48px;background:white;border:1px solid #d8dee7}.brand{font-weight:700;font-size:14px;letter-spacing:.07em;color:#a77a22}h1{font-size:30px;line-height:1.2;margin:14px 0}h2{font-size:19px;margin:0 0 12px}.meta{color:#667085}.score{font-size:24px;font-weight:700}section{padding:24px 0;border-top:1px solid #d8dee7}.narrative{white-space:pre-wrap;overflow-wrap:anywhere}details{font-size:12px;color:#667085;margin-top:18px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #d8dee7;text-align:left;padding:9px;vertical-align:top;overflow-wrap:anywhere}th{background:#16324f;color:white}.DONE{background:#d9eedc}.W{background:#f8d7da}.C{background:#fff0b3}.Blank{background:#48515c;color:white}.hint{font-size:13px;color:#667085}footer{border-top:1px solid #d8dee7;padding-top:20px;font-size:12px;color:#667085}@media print{@page{size:A4;margin:16mm}body{background:white}main{border:0;margin:0;padding:0;max-width:none}.hint{display:none}h2{break-after:avoid}tr{break-inside:avoid}details{display:none}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body><main><div class="brand">MYTALENT EDUCATION</div><h1>Feedback form</h1><p class="meta">${html(selected.studentName)} · ${html(test.title)}<br>Test date ${html(selected.date)} · Report ${html(feedback.date)}</p><p class="score">${score} / ${maximum}</p><p class="hint">Print this document or choose Print → Save as PDF.</p>${sections}<section><h2>Approved marking evidence</h2><table><thead><tr><th>Question / topic</th><th>Marks</th><th>Outcome</th><th>Evidence &amp; tutor feedback</th></tr></thead><tbody>${rows.map(row => `<tr><td>${html(row.questionId)}<br>${html(row.topic)}</td><td>${row.marks}/${row.maxMarks}</td><td class="${row.outcome}">${row.outcome}</td><td>${html(row.evidence)}<br>${html(row.reason)}${row.tutorNote ? `<br><strong>Tutor:</strong> ${html(row.tutorNote)}` : ""}</td></tr>`).join("")}</tbody></table></section><footer>Feedback drafted by Codex from tutor-approved evidence, for tutor review before sharing. Approved ${html(selected.approvedAt)} · revision ${selected.revision}. Manager summary covers the reporting date; it is not a record of messages sent.</footer></main></body></html>`;
}
