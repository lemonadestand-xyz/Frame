# Tasks — Supervisor as the intake funnel + cross-project orchestration hub

- T01 · Confirm spec.md §11 (a)–(e) with Chris and capture §9 open-question answers inline in spec.md
- T02 · Reconcile or create `SUPERVISOR_REPO/.frame/specs/cross-project-dashboard/{spec,plan,tasks}.md` and dispatch it via Frame's Orchestrator from the supervisor repo
- T03 · Scaffold `SUPERVISOR_REPO/.frame/specs/intake-api-and-receiver/{spec,plan,tasks}.md` defining the typed intake API + HTTP / file-drop / Loom receivers writing to `intake/inbox/*.json`, then dispatch it
- T04 · Scaffold `SUPERVISOR_REPO/.frame/specs/classifier-spec-proposer/{spec,plan,tasks}.md` covering intake-to-proposal classifier with Basic Memory lookup and >70% confidence threshold, then dispatch it
- T05 · Scaffold `SUPERVISOR_REPO/.frame/specs/approval-inbox-pwa/{spec,plan,tasks}.md` covering PWA inbox UI plus atomic temp+rename write of approved spec.md into the target project's `.frame/specs/`, then dispatch it
- T06 · Fix supervisor bug #44 (critic over-firing on completion summaries) before any MCP exposure of the critic
- T07 · Scaffold `SUPERVISOR_REPO/.frame/specs/supervisor-mcp-server/{spec,plan,tasks}.md` exposing `mcp__supervisor__classify_decision` / `__critique_outcome` / `__escalate`, then dispatch it
- T08 · Scaffold `SUPERVISOR_REPO/.frame/specs/playwright-qa-agent-profile/{spec,plan,tasks}.md` covering the QA profile + harness writing pass/fail to a spec's `outcome.md` post-approval, then dispatch it
- T09 · Scaffold `SUPERVISOR_REPO/.frame/specs/meeting-transcript-pipeline/{spec,plan,tasks}.md` wiring Loom comment → receiver → classifier → proposal → inbox → approval → spec scaffold end-to-end, then dispatch it
- T10 · Write `outcome.md` for this spec listing children that landed, children deferred, §11 confirmations, and §9 answers; open a follow-up roadmap entry for §7 row 8+ (per-project flows, Slack adapter completion, calendar adapter)
