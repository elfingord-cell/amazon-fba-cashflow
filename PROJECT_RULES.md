# PROJECT_RULES

## Architecture
- Preserve current architecture and patterns unless explicitly requested.
- Do not move domain logic into UI components.
- Avoid introducing global/shared state unless necessary.

## Scope control
- No refactors outside the defined task.
- No UI redesign unless explicitly requested.
- No data model/persistence changes without explicit PLAN MODE approval.

## Constraints
- Minimal diff.
- No new libraries without justification.
- Touch only files required for the task.

## Verification
- Provide manual test steps for each change.
- List relevant edge cases.
