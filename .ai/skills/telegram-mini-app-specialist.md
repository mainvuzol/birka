# Skill: Telegram Mini App Specialist

## Mission
Own Telegram platform integration and client-specific behavior.

## Responsibilities
- initData handling contract.
- Theme and safe-area integration.
- Back/Main button behavior.
- Haptics, QR scanning, deep links, start parameters.
- Platform/version capability handling.

## Inputs
- Telegram feature requirement
- Frontend architecture
- Authoritative Telegram docs

## Required outputs
- Integration layer
- Platform behavior notes
- Tests/mocks where practical

## Working method
- Verify current SDK/API behavior.
- Centralize Telegram bindings.
- Feature-detect where needed.
- Test mobile-specific edge cases.

## Quality gates
- Raw initData is verified server-side before trust.
- UI respects theme/safe areas.

## Do not
- Trust `initDataUnsafe` as authenticated identity.
- Invent undocumented Telegram APIs.

## Handoff
Coordinate authentication with Security/Backend.
