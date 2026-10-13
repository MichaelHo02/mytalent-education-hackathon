import { calendarDate } from "./domain";
import type { SavedBrief, WorkspaceState } from "./types";

export type FreshFeedback = {
  student?: SavedBrief;
  parent?: SavedBrief;
  manager?: SavedBrief;
  complete: boolean;
  date: string;
};

/** Shared by the review page and export: a saved narrative is not ready if its evidence changed. */
export function getFreshFeedback(state: WorkspaceState, submissionId: string, reportingDate?: string): FreshFeedback {
  const selected = state.submissions.find(item => item.id === submissionId);
  const date = reportingDate ?? (selected?.approvedAt ? calendarDate(selected.approvedAt) : selected?.date ?? "");
  const result: FreshFeedback = { complete: false, date };
  if (!selected || selected.status !== "approved") return result;
  const approved = new Map(state.submissions.filter(item => item.status === "approved").map(item => [item.id, item]));
  const activities = state.activities.filter(item => item.date === date);
  const activityIds = new Set(activities.map(item => item.id));
  const dailyPapers = [...approved.values()].filter(item => item.approvedAt && calendarDate(item.approvedAt) === date);
  const briefs = [...(state.briefs ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  function current(brief: SavedBrief): boolean {
    if (!brief.text.trim() || !brief.evidenceRefs.length) return false;
    const cited = new Set<string>();
    for (const reference of brief.evidenceRefs) {
      const source = [...approved.values()].find(item => item.id === reference || item.questions.some(q => `${item.id}:${q.questionId}` === reference));
      if (source) {
        if (brief.sourceRevisions[source.id] !== source.revision) return false;
        cited.add(source.id);
      } else if (brief.audience !== "manager" || !activityIds.has(reference)) return false;
    }
    return Object.keys(brief.sourceRevisions).every(id => cited.has(id));
  }

  for (const audience of ["student", "parent"] as const) {
    result[audience] = briefs.find(brief => brief.audience === audience && brief.submissionId === selected.id && brief.date === date && current(brief)
      && brief.sourceRevisions[selected.id] === selected.revision && Object.keys(brief.sourceRevisions).length === 1);
  }
  result.manager = briefs.find(brief => brief.audience === "manager" && !brief.submissionId && brief.date === date && current(brief)
    && brief.sourceRevisions[selected.id] === selected.revision
    && dailyPapers.every(paper => brief.sourceRevisions[paper.id] === paper.revision)
    && activities.every(activity => brief.evidenceRefs.includes(activity.id)));
  result.complete = Boolean(result.student && result.parent && result.manager);
  return result;
}
