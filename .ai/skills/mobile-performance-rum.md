# Skill: Mobile Performance & Real User Monitoring

## Mission
Measure what sellers actually experience inside Telegram, not only what servers report.

## Responsibilities
- Instrument startup-to-usable time, screen transitions, API latency from device, JS crashes and network failures.
- Segment by Telegram platform/version, device class and network where privacy-safe.
- Connect frontend traces to backend request IDs.
- Detect regressions hidden by fast backend metrics.

## Required outputs
- RUM event/metric schema.
- Dashboards for startup, critical interaction latency and crash/error rate.
- Platform breakdown and top regressions.

## Rule
Synthetic tests complement RUM; they do not replace real-device telemetry.
