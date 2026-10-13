# Guided sidebar update — 13 October 2026

Working checkout: `/Users/holeminhthach/Developer/Hackathon/tutor-guided-sidebar`, branch `codex/tutor-guided-sidebar`.

User confirmed the guided Codex flow and explicitly removed all manual record-entry forms and saved-rubric selection. The primary button reads **Mark student work with Codex** and uses the icon from the installed OpenAI desktop app. Codex asks for photos and optional supplied rubric, matches a saved guide when possible, saves draft marks and feedback. The sidebar displays evidence and approves results; revisions are requested through Codex. Approval derives all three Exhibits and requests student/parent/manager briefs through the host SDK. The reporting date resets to the actual approval date.

The Site access policy is now **public**. Website guests remain separate from the signed-in plugin workspace. Local D1 was initialised in the new worktree; the user explicitly says demo data need not persist if storage needs replacement.

Exhibit 1 has DONE/W/C/Blank, syllabus topics and evidence. Exhibit 2 aggregates topic evidence; no full course catalogue or confirmed mastery rubric was supplied, so it explicitly awaits tutor mastery confirmation. Exhibit 3 describes only attempts recorded in this workspace, not lifetime attempts or inferred pass/fail.

The canonical plugin has the tutor-workflow skill uploaded through Plugin Creator, version 1.0.2. The backend reports the plugin already installed. Plugin catalogue presentation is owned by Sites and previously retained the old label Tutor Workspace; the MCP entrypoint and app UI are MyTalent Education. Never create a duplicate plugin. Verify deployment/catalogue refresh separately.

Validation: 28 unit/domain/SDK mock-host tests and TypeScript passed. The user explicitly volunteered to test the installed native app, so native messaging, attachment interpretation and live marking remain for their verification. Do not claim that full native flow has passed.

Source publication through the Sites helper makes its required deployment snapshot commit. No GitHub main merge is requested; the original main checkout is unchanged.

---

# MyTalent Education session handoff

The hackathon prototype helps a learning support tutor mark photographed paper tests, update administrative records, and prepare evidence-based student, parent and manager conversations. The next session should finish deployment and verify the real host workflow. The current source snapshot is saved to GitHub; the deployed Site is an earlier version.

## Agreed product decisions

- Use Sites plus its canonical plugin and OpenAI MCP Apps extensions. The sidebar is an agent workspace: buttons start Codex conversation workflows, tools save results, and the sidebar refreshes.
- Primary actions: Upload and mark with Codex, Update log with Codex, Generate brief with Codex. Manual forms are collapsed. Use standard shadcn UI with three tabs.
- Codex processes chat attachments or reads saved photos through tools. No separate OpenAI API key is required for this host-driven path. Host ui/message starts a conversation turn; direct subagent spawning is not an app API guarantee. The host agent may delegate when supported.
- Focus on materials with supplied worked solutions and marking rules. Tutor approval is required before marks enter exports or feedback. No automatic messages to parents or retest decisions.
- Export CSV first. Centre-specific spreadsheet templates have not been supplied.
- Name is MyTalent Education. Supplied logo is public/mytalent-logo.png and is embedded as a data URI in the MCP App build.
- User requested public Site access without sign-in. Source implements isolated browser guest sessions; Codex tools retain host identity. Public browser records and Codex-owned records are separate. Standalone agent buttons open the plugin.
- User removed the fictional demo. Its generator and endpoint are gone; lib/reference-materials.ts filters the exact legacy fixture and adds an official reference guide without student records.
- User explicitly allowed GitHub publication directly to main for this hackathon.

## Workspace and source

Project: /Users/holeminhthach/Developer/Hackathon/tutor-workspace

GitHub repository: https://github.com/MichaelHo02/mytalent-education-hackathon

The original Sites source snapshot is commit 16a4c699acfe5f46b042cffa184438b60fb94674. Later source changes include the agent-first interface, branding, guest access, fictional demo removal and VCAA guide. They are in the GitHub handoff snapshot but have not been published to Sites.

Important files:

- app/components/Workspace.tsx: three-tab shadcn UI, agent buttons and review workflow.
- app/components/HostBridge.tsx and lib/host-bridge.ts: SDK initialization, host messages, tools transport, uploads and exports.
- app/mcp/route.ts: stateless HTTP MCP endpoint, sidebar/thread entrypoints, guides, photo retrieval, draft marking, admin and conversation tools.
- lib/domain.ts, lib/store.ts, lib/types.ts: validated marks, approval, owner-scoped D1 records, R2 originals, exports and briefs.
- lib/reference-materials.ts: official 2026 NHT Exam 1 Questions 1–3 reference, 12 marks, whole-mark increment. It was the last addition before wrap-up and needs its dedicated checks.
- app/api/_shared.ts: bounded request parsing and anonymous guest sessions.
- .openai/hosting.json: persisted Site identity, D1 DB, R2 BUCKET, MCP capability.
- scripts/build-mcp-app.mjs: emits inline HTML resource and public/mcp-app.html. Run after UI changes, then build the Site.
- plugin-overlay/skills/tutor-workflow/SKILL.md: workflow instructions prepared locally; not yet uploaded to the canonical plugin.

## Verified hosting state

Site project ID: appgprj_6acdc61e4b248191a16a63a81ec0182b

Site URL: https://tutor-evidence-workspace.quick-scarf-1289.chatgpt.site

MCP URL and OAuth resource: https://tutor-evidence-workspace.quick-scarf-1289.chatgpt.site/mcp

Canonical plugin ID: plugin_asdk_app_sites_6a8a554913148191a4ecd150b050413d

Version 1 deployment succeeded with MCP enabled. It remains owner-private (custom access); the requested public policy change has NOT been applied. Sites display title was updated to MyTalent Education, but the newer UI/logo source is not deployed. Plugin installation/connection and native sidebar interaction are NOT verified. The initial install suggestion was shown under Tutor Workspace.

Do not create a duplicate Site or plugin. Reuse these IDs. Source credentials were kept only in session memory and expire; obtain a fresh one through Sites tools. Never put tokens into source, command arguments or handoff documents.

## Demonstration materials

2025 originals: /Users/holeminhthach/Developer/Hackathon/reference-materials/vcaa-2025

Matching 2026 materials: /Users/holeminhthach/Developer/Hackathon/reference-materials/vcaa-2026

Downloaded and verified: Exam 1 and Exam 2 PDFs, both assessment-guide DOCX files, both assessment-report DOCX files.

Source page: https://www.vcaa.vic.edu.au/assessment/vce/examination-specifications-past-examinations-and-examination-reports/mathematical-methods

Paper photos: /Users/holeminhthach/Developer/Hackathon/output/student-work-photos

The photos show 2026 VCE NHT Methods Exam 1, not the 2025 paper. Their README identifies them as generated sample photos and notes a deliberate calculation error on page 05, Q3b. Do not describe them as real student records or assume generated notation perfectly matches the original. Pages 03–05 match the starter guide subset. Do not publish student photos as public assets without checking their nature and intended access.

A temporary LibreOffice rendering of the official guide is at /tmp/tutor-vcaa-reading/2026-NHT-MathMethods1-assessment-guide.pdf. The reference-module author visually checked equations on rendered pages 4–5; recheck when reviewing the transcription.

## Validation completed

- 19 domain/auth/parser tests passed on the final handoff source. Dedicated reference-module/whole-mark checks are still pending.
- TypeScript passed on the final handoff source. Changed-file ESLint passed before the last reference addition.
- Earlier final built Worker integration passed identity, file ownership and actual image bytes, partial credit, review gate, revision conflicts, approved-only CSV, chat attachment references, activities, saved briefs and MCP discovery/resources.
- Guest sessions were checked live for bootstrap, persistence, visitor isolation, invalid cookies and signed-in priority.
- UI was inspected in the in-app browser. The latest agent-first/branding version is locally saved; host actions were SDK-tested against a simulated host, not verified against an installed native plugin.
- Local dev server 5173 and built Worker 5174 were stopped during wrap-up. The browser tab may still show the prior preview.

## Next steps

1. Inspect the last reference-module/store/domain additions; run npm test and npx tsc --noEmit --incremental false. Add focused checks for official whole marks, reference totals and preserving real records while removing legacy demo fixtures.
2. Align the marking Input step with test.markIncrement (UI currently uses 0.5); add optional markIncrement to the create_test MCP schema if centre guides need to specify it.
3. Rebuild the MCP HTML, then build the Site. Apply no new migration unless schema changes; the existing schema is already generated.
4. Publish the latest exact source through the Sites source helper. Change Site access to public using the native access tool as requested, verify an anonymous browser can open it and start a separate guest workspace.
5. Inspect the canonical plugin's current files/release. Ensure display name and branding reflect MyTalent Education through its owning App/Site. Add the prepared workflow skill using Plugin Creator, preserving IDs and App configuration. No duplicate plugin.
6. Offer installation of the final named plugin, then verify a read-only tool and the actual sidebar entry. If tools need a fresh chat, explain the host requirement; do not claim connection just because the Site deployed.
7. Demonstrate Upload and mark with Codex using pages 03–05 and the matching official guide. Verify actual photos reach the host model, draft marks save, tutor approval feeds CSV records, and a generated brief saves back to the sidebar with traceable evidence.
8. Keep the user informed after checkpoints. They want manual verification and simple design, and asked to wrap this long session rather than keep implementing here.
