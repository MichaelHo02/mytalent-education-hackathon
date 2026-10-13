import type { Test, WorkspaceState } from "./types";

export const OFFICIAL_REFERENCE_ID = "vcaa-2026-nht-methods1-q1-3";
export const OFFICIAL_PAPER_URL = "https://www.vcaa.vic.edu.au/sites/default/files/2026-06/2026-NHT-MathMethods1.pdf";
export const OFFICIAL_GUIDE_URL = "https://www.vcaa.vic.edu.au/sites/default/files/2026-06/2026-NHT-MathMethods1-assessment-guide.docx";

// Transcribed from the original DOCX tables and visually checked equations in the
// rendered guide (pages 4–5), against examination pages 3–5. Topic names are app labels.
// The epoch is a reference-record sentinel, not an asserted publication date.
export const OFFICIAL_DEMO_TEST: Test = {
  id: OFFICIAL_REFERENCE_ID,
  title: "2026 VCAA NHT Methods Exam 1 — Questions 1–3",
  createdAt: "1970-01-01T00:00:00.000Z",
  markIncrement: 1,
  questions: [
    { id: "Q1a", topic: "Product rule and logarithms", maxMarks: 2, criteria: "1 method mark: evidence of the product rule, with two terms and one containing a logarithm. 1 answer mark: dy/dx = 3x² log_e(5x) + x², or x²(3 log_e(5x) + 1). The guide accepts either form and explicitly does not accept y = as the derivative label." },
    { id: "Q1b", topic: "Antiderivatives and an initial condition", maxMarks: 2, criteria: "Direct integration: 1 method mark for a correct antiderivative; 1 answer mark for f(x) = (x−2)^4/4 + 3/4 or an equivalent form. The guide requires +c in the antiderivative and dx. Expansion method: 1 method mark for a correct antiderivative from the student's non-trivial expansion; 1 answer mark for f(x) = x^4/4 − 2x³ + 6x² − 8x + 19/4 or an equivalent form. The guide requires +d in the antiderivative and dx." },
    { id: "Q2", topic: "Rational-function parameters", maxMarks: 3, criteria: "1 answer mark for a = 6. 1 method mark for forming two equations and attempting to reduce them to one equation by substitution or elimination. Reference equations: −m/2 + c = 0 and m/6 + c = 24. 1 answer mark for both m = 36 and c = 18." },
    { id: "Q3a", topic: "Probability of combined outcomes", maxMarks: 1, criteria: "1 answer mark for 85/100 = 17/20 = 0.85 = 85%, accepting any equivalent form." },
    { id: "Q3b", topic: "Expected value", maxMarks: 2, criteria: "1 method mark: show a sum of three cost × probability terms using the correct costs $5, $8 and $12 with probability values. Reference working: E(X) = 5×0.60 + 8×0.25 + 12×0.15 = 3.00 + 2.00 + 1.80. 1 answer mark for $6.80 (6 dollars 80 cents), with equivalent 6.8 or 34/5 accepted." },
    { id: "Q3c", topic: "Binomial probability", maxMarks: 2, criteria: "1 method mark: evidence of a binomial expression whose powers add to 5, with probabilities equivalent to 3/5 and 2/5. Reference expression: P(Y=4) = C(5,4)(0.6)^4(0.4)^1 = 5(3/5)^4(2/5). 1 answer mark for 162/625 = 810/3125 = 0.2592, accepting any equivalent form." },
  ],
  guideText: `Verified reference: 2026 VCAA NHT Mathematical Methods Examination 1, Questions 1–3 only (12 marks).
Official question paper: ${OFFICIAL_PAPER_URL}
Official assessment guide: ${OFFICIAL_GUIDE_URL}
Question paper pages 3–5; original assessment guide marking table pages 4–5. This app transcription is a reference aid, not a VCAA endorsement. No student answers or results are provided by this reference.

General marking rules from the guide: award whole marks only; half marks must not be awarded. Ignore crossed-out working. An entirely crossed-out genuine attempt receives zero, while a response with no genuine attempt is recorded as not attempted. For questions worth more than one mark, appropriate working must be shown. Apply the supplied method and answer marks; do not invent a new partial-credit scheme. The original guide sends responses it does not address for assessor determination; in this prototype leave them flagged for tutor review. Illegible or missing working also remains unresolved. Consider consequential errors only as the guide permits, including Q1b's non-trivial expansion method.

Q1a (2 marks). Given y = x³ log_e(5x), find dy/dx.
Worked solution: dy/dx = 3x² log_e(5x) + x³×(1/(5x))×5 = 3x² log_e(5x) + x² = x²(3 log_e(5x) + 1).
Allocation: 1 M for product-rule evidence: two terms, one with a logarithm. 1 A for either correct derivative form; not y =.

Q1b (2 marks). Given f'(x) = (x−2)³ and f(1)=1, find f(x).
Method 1: f(x) = ∫(x−2)³ dx = (x−2)^4/4 + c. Substituting x=1 gives 1/4 + c = 1, so c=3/4 and f(x) = (x−2)^4/4 + 3/4.
Allocation: 1 M for correct antiderivative. 1 A for equivalent correct final forms; the guide requires +c in the antiderivative and dx.
Method 2: expand f'(x) = x³ − 6x² + 12x − 8. The antiderivative is f(x) = x^4/4 − 2x³ + 6x² − 8x + d. Substituting f(1)=1 gives d=19/4. Final f(x) = x^4/4 − 2x³ + 6x² − 8x + 19/4.
Allocation: 1 M for a correct antiderivative from the student's non-trivial expansion. 1 A for equivalent correct final forms; the guide requires +d in the antiderivative and dx.

Q2 (3 marks). The rule is y = m/(x+a) + c, with x-intercept (−8,0), y-intercept (0,24) and vertical asymptote x=−6. Find a, c and m.
Worked solution: asymptote gives a=6. Using intercepts gives −m/2 + c = 0, so c=m/2; and m/6 + c = 24. Substitution gives m/6 + m/2 = 24, hence 2m/3=24, m=36 and c=18.
Allocation: 1 A for a=6; 1 M for forming two equations and attempting reduction to one by substitution or elimination; 1 A for both m=36 and c=18.

Q3 context: tickets cost $5 for less than 10 minutes, $8 for 10–20 minutes and $12 for more than 20 minutes. Respective probabilities are 60%, 25% and 15%.
Q3a (1 mark). Probability of a ticket for 20 minutes or less: 0.60+0.25 = 85/100 = 17/20 = 0.85 = 85%. Allocation: 1 A, any equivalent form.
Q3b (2 marks). Mean ticket price: E(X) = 5×0.60 + 8×0.25 + 12×0.15 = 3.00+2.00+1.80 = $6.80 (6 dollars 80 cents).
Allocation: 1 M requires the sum of three terms, with correct costs $5, $8 and $12 and probability values; 1 A accepts equivalent 6.8 or 34/5.
Q3c (2 marks). Exactly four of a sample of five visitors bought tickets for less than 10 minutes: P(Y=4) = C(5,4)(0.6)^4(0.4)^1 = 5(3/5)^4(2/5) = 810/3125 = 162/625 = 0.2592.
Allocation: 1 M for binomial evidence with powers adding to 5 and equivalents of 3/5 and 2/5; 1 A, any equivalent correct form.`,
};

/** Remove only the retired fictional fixture, then make the verified guide available. */
export function withOfficialReference(state: WorkspaceState): WorkspaceState {
  const retiredTests = new Set(state.tests.filter(test => test.title === "Fictional demo — Functions checkpoint").map(test => test.id));
  const retiredSubmissions = new Set(state.submissions.filter(submission => retiredTests.has(submission.testId)).map(submission => submission.id));
  const isRetiredName = (value: string) => value.endsWith("(fictional demo)");
  const retiredActivities = new Set(state.activities.filter(activity => isRetiredName(activity.studentName) || activity.notes.startsWith("Fictional demo")).map(activity => activity.id));
  const tests = state.tests.filter(test => !retiredTests.has(test.id));
  if (!tests.some(test => test.id === OFFICIAL_REFERENCE_ID)) tests.push(structuredClone(OFFICIAL_DEMO_TEST));
  return {
    ...state,
    tests,
    submissions: state.submissions.filter(submission => !retiredSubmissions.has(submission.id)),
    activities: state.activities.filter(activity => !retiredActivities.has(activity.id)),
    followups: state.followups.filter(followup => !isRetiredName(followup.studentName) && !followup.task.startsWith("Fictional demo:")),
    ...(state.briefs ? { briefs: state.briefs.filter(brief => !retiredSubmissions.has(brief.submissionId ?? "") && !Object.keys(brief.sourceRevisions).some(id => retiredSubmissions.has(id)) && !brief.evidenceRefs.some(ref => retiredActivities.has(ref) || [...retiredSubmissions].some(id => ref === id || ref.startsWith(`${id}:`)))) } : {}),
  };
}
