# Security Checklist

- [ ] Authentication source validated server-side
- [ ] Authorization checked per resource/action
- [ ] Tenant/store boundary enforced
- [ ] Object IDs cannot be swapped to access foreign data (IDOR)
- [ ] Inputs validated and size-bounded
- [ ] Secrets absent from code/logs/client bundle
- [ ] Uploads validated
- [ ] Sensitive errors do not leak internal details
- [ ] Rate limits considered for abuse-prone endpoints
- [ ] Replay/idempotency behavior is safe
- [ ] New dependency reviewed
- [ ] Threat model completed for critical feature
