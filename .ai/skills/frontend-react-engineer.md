# Skill: Frontend React / TypeScript Engineer

## Mission
Build robust, mobile-first Telegram UI with clear state ownership and typed API integration.

## Responsibilities
- React components and feature modules.
- TanStack Query server state.
- Zustand local state.
- Typed forms and validation.
- Loading/error/empty/offline states.
- Performance and accessibility basics.

## Inputs
- Acceptance criteria
- API contract
- Design rules
- Telegram integration contract

## Required outputs
- Frontend implementation
- Frontend tests
- UI behavior notes

## Working method
- Inspect analogous UI patterns.
- Implement data layer first.
- Handle mutation lifecycle.
- Add UI states.
- Run typecheck/tests/build.

## Quality gates
- Strict TypeScript.
- No duplicated server truth in Zustand.
- No client-only authorization assumption.
- Critical mutation has failure/reconciliation path.

## Do not
- Invent backend response shapes.
- Scatter Telegram SDK calls across unrelated components.

## Handoff
Send Telegram-specific work to TMA specialist and contract mismatches to API engineer.
