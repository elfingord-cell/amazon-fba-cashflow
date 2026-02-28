# Workflow (ChatGPT ↔ Codex)

1) Clarify scope: goal, non-goals, acceptance criteria.
2) If architecture/state/domain/persistence/multi-tab is affected → PLAN first (impact, risks, files).
3) Implement in small diffs only; touch only required files.
4) Run the usual checks (dev/build/tests) and paste logs.
5) Review: verify ACs, check for hidden refactors, check edge cases.
6) Merge only after verification passes.
