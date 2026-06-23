# Frame ↔ Supervisor profile + memory bridge

> **What we're building:** Close three migration gaps left by the
> `frame-parity-with-supervisor` push: (1) translate supervisor YAML
> profiles into `.frame/profile.json`, (2) unify the Basic Memory
> namespace on the canonical project name (instead of Frame's hashed
> `frame-mirror-project-XXXX/` dirs), and (3) surface Profile + Memory
> at the project level (not just the spec level).

---

## Background

The parity push (`frame-parity-with-supervisor` + children) shipped
working engines and spec-level tabs, but never:

1. Migrated supervisor profiles. Six canonical YAML profiles live in
   `<supervisor>/profiles/` (`localized`, `kitli-kids`, `mason`,
   `cengage-intake`, `renovive-services`, `renovive-qa`, plus
   `supervisor-self`). Frame's nudge banner reports "no profile" for
   every one of these projects because the supervisor's policy never
   crossed the boundary.

2. Wired Frame memory to the supervisor convention. Both sides write to
   `~/memory/<id>/`. The supervisor uses named ids (`~/memory/localized/`);
   Frame's backend was being constructed with `projectId` from upstream
   callers that hashed the project path. The two namespaces never
   converged.

3. Surfaced Profile + Memory at the project level. Both lived only on
   `specSection.js`, even though they are project-level concerns.

---

## Problem

- Users opening Localized in Frame see "no profile" even though the
  supervisor has a comprehensive policy for it.
- Memory writes from Frame land in `~/memory/frame-mirror-project-XXXX/`,
  invisible to the supervisor's `~/memory/localized/` store. Cross-process
  memory sharing — the parity push's stated goal — silently breaks.
- Profile + Memory render under the spec section, requiring the user to
  open a spec to inspect or edit them, even though they're per-project.

---

## Goals (acceptance criteria)

1. A one-shot migration script generates `.frame/profile.json` for every
   project in a canonical mapping table.
2. The memory backend resolves project ids from `profile.project.memoryId`,
   falling back to `profile.id` then the path basename.
3. Profile + Memory tabs are visible at the project level in the running
   Frame UI, alongside the existing spec-level tabs.
4. A "supervisor profile found" banner offers a one-click migrate when
   a workdir has a canonical supervisor YAML but no `.frame/profile.json`.
5. `loadProfile()` falls back to the supervisor YAML on the fly when no
   `.frame/profile.json` exists — translated, not written to disk.
6. Test suite stays green; no new external deps.
