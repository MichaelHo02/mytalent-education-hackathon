# Tutor Workspace

A private Sites app and MCP sidebar workspace for photographed paper tests, tutor review, administration and evidence-based conversations. Codex processes photos through chat; the app never pretends that a browser button invoked an independent AI model.

## Run locally

```sh
npm run dev
```

Open the printed loopback URL. Sign in via the starter's local ChatGPT sign-in simulation. D1 migrations must be applied to the local preview after the first build. Production sign-in is owned by Sites.

## Manual checkpoints

1. Workspace: create a test, paste worked solutions and marking rules, add question IDs/topic/maximum marks/criteria. Upload a photographed submission using an anonymised student alias. Check the saved preview.
2. Records: edit draft question marks, evidence and explanation; unresolved items prevent approval. Save, approve, reload and export marking/progress/exam CSVs. Log actual Q&A/contact/attendance/SAC activity and a follow-up. Check daily summary and evidence-backed conversation cards. Empty workspaces stay empty; the optional demo is fictional.
3. Plugin: install the Site-generated Tutor Workspace plugin. Open its sidebar entry. Use Send to Codex with an uploaded photo, verify photo retrieval and draft marks, then approve in the app. Generate a brief and verify each cited source. A website deployment does not prove the installed host integration works.

## Build and checks

```sh
node scripts/build-mcp-app.mjs
npx tsc --noEmit --incremental false
npm test
node /absolute/path/to/sites/scripts/build-site.mjs
```

The MCP App resource is bundled with inline JavaScript and CSS. Its UI uses MCP tools for API transport and does not depend on third-party iframe cookies. The website uses the same component and ordinary authenticated API requests.

## Storage and evidence

D1 stores owner-scoped workspace records with optimistic concurrency. R2 stores uploaded originals. Only approved question results feed exports and feedback. Approved marking is immutable; upload a new submission for a new attempt. No mastery status is inferred from a single question. CSV exports neutralise formula-looking text.

Chat-only attachments are visible to Codex but are not automatically archived by the plugin. Upload originals inside the workspace when persistent photo evidence is needed. The image tool accepts JPEG/PNG/WebP; attach PDFs to the conversation for model processing. Tutor-supplied guide text preserves explicit marking rules; no generic extraction is represented as mathematically verified.

## Publishing

The source is maintained on `feature/tutor-workspace`. Sites' source helper creates the source snapshot, pushes the exact reviewed version, packages and privately publishes it. Do not expose source credentials, tokens or runtime secrets. The plugin skill source is in `plugin-overlay/skills/tutor-workflow/SKILL.md`; add it to the canonical Site-created plugin rather than creating a duplicate plugin.
