# ENGINEERING_MANIFEST_V1

## Core rules
- Plan before build for non-trivial changes.
- Minimal diff only: change only what the task requires.
- No refactors outside scope.
- No new libraries/dependencies without explicit justification.
- Keep business/domain logic out of UI components.
- Every task must have 3–7 testable acceptance criteria.
- Verification is required (manual steps + key checks) before merge.

## Change discipline
- One change = one responsibility.
- Preserve existing patterns unless explicitly requested.
- Avoid incidental formatting churn.

## Review before merge
- Check scope violations, hidden refactors, domain logic in UI, naming inconsistencies, and edge cases.
