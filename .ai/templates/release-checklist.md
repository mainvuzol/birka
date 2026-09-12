# Release Checklist

- [ ] Scope and release notes reviewed
- [ ] All required tests green
- [ ] Frontend build/typecheck green
- [ ] Backend lint/typecheck green
- [ ] Migrations reviewed and tested
- [ ] Backup/restore implications understood
- [ ] Security findings resolved or explicitly accepted
- [ ] Critical E2E green
- [ ] Observability/logging added for new critical paths
- [ ] Rollback plan exists
- [ ] Staging smoke test passed
- [ ] Human approval obtained where policy requires it
- [ ] Production health checked after release

## Product Excellence Gates
- [ ] Golden paths pass: auth/open, scan/find, sale, stock verification, refund.
- [ ] Critical performance budgets are within tolerance or explicitly accepted.
- [ ] Critical write paths cover retry/duplicate/lost-response behavior.
- [ ] Tenant/RBAC isolation checks pass when relevant.
- [ ] Business events and request correlation are observable.
- [ ] Historical corrections use compensating operations, not destructive edits.
- [ ] Backup/recovery impact has been considered for material data/schema changes.
- [ ] Production Readiness Review is READY or accepted READY_WITH_ACCEPTED_RISK.
