import type { WorkspaceState } from "./types";

const RETIRED_PARTIAL_GUIDE_ID = "vcaa-2026-nht-methods1-q1-3";

/** Retain a legacy guide only as a source for existing work; never inject defaults. */
export function withoutDefaultGuides(state: WorkspaceState): WorkspaceState {
  const referencedTests = new Set(state.submissions.map(submission => submission.testId));
  return {
    ...state,
    tests: state.tests.filter(test => referencedTests.has(test.id) || (test.id !== RETIRED_PARTIAL_GUIDE_ID && test.title !== "Fictional demo — Functions checkpoint")),
  };
}
