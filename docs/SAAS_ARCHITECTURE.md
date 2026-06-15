# SaaS Architecture

How to evolve `lti-moodle-integration` from a per-deployment library into a
**hosted, multi-tenant service**. This is a design document, not an
implementation guide — it states the target architecture, the gap from today,
and the work each path requires so the team can decide before writing code.

> The package today is consumed in-process: one deployment, one
> `LTI_ENCRYPTION_KEY`, one `LTI_DB_URL`, one set of platform registrations. SaaS
> means *many* customers share *one* running service, so every "one" above
> becomes "per-tenant". That partitioning is the whole job.

---

## Contents

1. Two product shapes (pick one)
2. What already helps
3. Shape 2a — Managed LTI gateway
4. Shape 2b — Fully hosted product
5. Tenant isolation
6. Key & secret management
7. Data model additions
8. Onboarding & self-serve registration
9. Operational concerns
10. Phased roadmap
11. Open decisions

---

## 1. Two product shapes (pick one)

| | 2a. Managed LTI gateway | 2b. Fully hosted product |
|---|---|---|
| What you sell | LTI launch-as-a-service; customer keeps their own app | The whole grouping app, hosted |
| Who owns the end-user UI | The customer | You |
| The adapter becomes | A **network call** (webhook/OIDC) to the customer app | The existing in-process adapter, tenant-scoped |
| Customer integration effort | Low (point Moodle at you, receive a signed identity) | None (they just use your app) |
| Your scope | LTI core + platform/key store + identity forwarding | Everything: app, billing, support, data isolation |
| Best when | Many apps need "launch from Moodle" but not grouping | You want to monetise the grouping product itself |

Both are viable. **2a leverages this package most directly** — it productises
exactly the LTI core that already exists. **2b is a bigger business** but most of
the new work is generic SaaS plumbing, not LTI.

---

## 2. What already helps

The package is closer to multi-tenant than a typical single-app would be:

- **Adapter pattern** — the core never touches a database, so swapping the
  in-process adapter for a tenant-aware one (or a network adapter) is contained.
- **Platform registration is already data, not config** — platforms can be
  registered at runtime via the admin API/UI, not just env vars. Multi-tenant
  needs many platforms; the registration path exists.
- **Tenant hooks already in the interface** — `resolveEffectiveTenant`,
  `resolveTenantFromBinding`, `grantTeacherTenantAccess`, `getTenantMode`. These
  were designed as "first-class but optional"; SaaS makes them mandatory.
- **`ltijs` state is externalised** — the LTI engine's own platform/nonce/key
  store is already a separate datastore (`LTI_DB_URL` or a SQL plugin), so it can
  be partitioned without touching business data.

The gaps are: a single encryption key, a single ltijs state store assumed
global, no tenant entity, and no self-serve onboarding.

---

## 3. Shape 2a — Managed LTI gateway

You host the LTI core. Each customer registers their Moodle platform(s) pointing
at **your** domain, and tells you where to forward the bridged identity. A launch
becomes: Moodle → your gateway → (validate) → signed identity → customer app.

```
  Customer A's Moodle ─┐
  Customer B's Moodle ─┼─launch─▶ ┌──────────────────────────────┐
  Customer C's Canvas ─┘          │  LTI Gateway (this package)   │
                                  │  - OIDC + launch validation   │
                                  │  - tenant resolved from iss/  │
                                  │    client_id/deployment_id    │
                                  │  - per-tenant key & config    │
                                  └───────────────┬───────────────┘
                                                  │ signed identity (JWT/OIDC)
                                                  │ + tenant id + context
                              ┌───────────────────┼────────────────────┐
                              ▼                    ▼                     ▼
                       Customer A app       Customer B app        Customer C app
                       (webhook/redirect)   (OIDC client)         (redirect + JWKS)
```

**Tenant resolution.** A launch already carries `iss` + `client_id` +
`deployment_id`. That triple *is* the tenant key — map it to a tenant record at
launch time (replaces the single global platform assumption).

**Identity forwarding (the new "adapter").** Instead of calling an in-process
adapter that writes to your DB, the gateway hands the identity to the customer
app. Three delivery options, cheapest first:

1. **Signed redirect** — redirect to the customer's `launchUrl` with a
   short-lived JWT (signed by your gateway, verifiable via your JWKS). Reuses the
   existing bind-token pattern; the customer verifies one JWT. Recommended
   default.
2. **OIDC provider** — the gateway becomes an OIDC IdP; customer apps are OIDC
   clients. Standards-based, more setup per customer.
3. **Webhook + session** — POST the launch claims to a customer endpoint, get
   back a session URL. Most flexible, most moving parts.

**What the package needs for 2a:**

- A `GatewayAdapter` (new, thin) whose "resolve user / open resource" methods
  forward over the network instead of hitting a DB.
- Tenant-scoped platform registration and per-tenant signing keys (§6).
- A tenant-aware `ltijs` state store, or one `ltijs` instance per tenant (§5).

---

## 4. Shape 2b — Fully hosted product

Host this whole app (`backend` + `frontend`) for many institutions. The LTI core
stays in-process; the existing `LtiAdapter` is reused but every query is scoped to
a `tenantId`. Most of the new work is generic SaaS, not LTI:

- Tenant-scoped data access on every model (courses, groups, users, bindings).
- Tenant onboarding, custom domains/subdomains, branding.
- Billing/subscription, plan limits, usage metering.
- Per-tenant admin separation and support tooling.

The LTI-specific delta over today is the same as 2a's isolation work (§5–§6); the
rest is standard multi-tenant app engineering.

---

## 5. Tenant isolation

The defining decision. Three models, increasing isolation and cost:

| Model | LTI state store | Business data | Isolation | Cost / ops |
|---|---|---|---|---|
| **Pooled** | one shared store, every row tagged `tenantId` | shared tables, `tenantId` column + enforced filter | Logical only | Lowest |
| **Bridged** | shared store, tenant-tagged | schema-per-tenant (Postgres schema / Mongo DB-per-tenant) | Medium | Medium |
| **Siloed** | one `ltijs` instance per tenant | DB-per-tenant or stack-per-tenant | Strong | Highest |

Recommendation: **start pooled, design the data layer so a tenant can be promoted
to bridged/siloed** for customers who require data residency or stronger
isolation. Whatever the model, enforce tenant scoping in **one** place (a
repository/data-access layer or middleware), never ad hoc per query — a missing
`tenantId` filter is the classic multi-tenant data-leak bug.

`ltijs` caveat: it assumes it owns its collections. For pooled mode you either run
one `ltijs` instance with tenant-tagged platform records (requires verifying
ltijs keys platforms by `iss`+`clientId`, which it does) or run an instance per
tenant (simpler isolation, heavier memory). Validate this against the installed
`ltijs` version before committing.

---

## 6. Key & secret management

Today there is one `LTI_ENCRYPTION_KEY` (encrypts platform creds at rest) and one
tool keypair (the JWKS Moodle fetches). Multi-tenant needs:

- **Per-tenant tool keypairs** — each tenant's JWKS should be independent so one
  tenant's key rotation/compromise can't affect another. Expose per-tenant keyset
  URLs (e.g. `/t/:tenantId/lti/keys`) or a single keyset partitioned by `kid`.
- **Encryption key management** — move off a single static env key to a KMS
  (AWS KMS / GCP KMS / Vault) with per-tenant data keys (envelope encryption).
  The bind-token / identity-forwarding secret (§3) likewise becomes per-tenant or
  a KMS-managed signing key.
- **Rotation** — support key rotation without downtime: publish old+new keys in
  the JWKS during overlap, sign with new.

This is the single biggest security delta from the current design and should be
designed before any customer onboards.

---

## 7. Data model additions

New/changed entities (names illustrative):

```
Tenant        { id, name, status, plan, customDomain?, createdAt }
TenantPlatform{ id, tenantId, iss, clientId, deploymentId, authEndpoint,
                tokenEndpoint, keysetUrl, encryptedSecrets }   // replaces global platform reg
TenantKey     { id, tenantId, kid, publicJwk, encryptedPrivateKey, status }
TenantConfig  { tenantId, connectMode, launchUrl|forwarding, branding, limits }
```

Every existing business table (and the two LTI tables `LtiCourseMap`,
`LtiResourceLinkBinding`) gains a `tenantId` and a composite index leading with
`tenantId`. The launch-time lookup becomes
`(iss, clientId, deploymentId) → tenantId → config/keys`.

---

## 8. Onboarding & self-serve registration

For SaaS, platform registration must be self-serve instead of an admin/env step:

1. Customer signs up → a `Tenant` + tenant admin user is created.
2. Tenant admin opens a setup screen that **shows the three URLs to paste into
   their LMS** (login/launch/keyset), pre-filled with their tenant-scoped paths.
3. They paste the LMS-generated `client_id` / `deployment_id` back into your
   screen (or you auto-capture on first launch via dynamic registration — LTI
   Advantage Dynamic Registration is the standards-based way to skip manual
   copy-paste and is worth supporting later).
4. A test-launch check (the package already has `testPlatformConnection`)
   confirms the wiring before go-live.

This is a generalisation of the existing `LtiPlatformsAdmin` UI from "one global
admin" to "per-tenant admin".

---

## 9. Operational concerns

- **Rate limiting & abuse** — per-tenant quotas on launches and API calls.
- **Audit logging** — per-tenant launch/admin audit trail (compliance + support).
- **Observability** — tenant dimension on every metric/log/trace.
- **Data lifecycle** — export and hard-delete per tenant (offboarding, GDPR/PDPO).
- **SLA / status** — health of the gateway is now shared infrastructure; one bad
  deploy affects all tenants. Add staged rollouts.
- **Compliance** — HKU/PDPO data-handling for student PII across tenants.

---

## 10. Phased roadmap

```
Phase 0  Package install (done in this change) ───────────────┐
         lets multiple apps consume the core independently.    │
                                                               ▼
Phase 1  Tenant entity + pooled isolation + tenant-scoped
         platform registration. Single shared deploy, tenantId
         on every row. (Lowest-risk multi-tenant step.)
                                                               │
                                                               ▼
Phase 2  Per-tenant keys + KMS-backed secret management +
         per-tenant keyset URLs. (Security hardening.)
                                                               │
                                                               ▼
Phase 3  Shape 2a gateway: identity forwarding (signed redirect
         first), GatewayAdapter, self-serve onboarding +
         dynamic registration.
                                                               │
                                                               ▼
Phase 4  (Optional) Shape 2b hosted product: billing, custom
         domains, plan limits, bridged/siloed isolation tiers.
```

Each phase is independently shippable and reversible. Phases 1–2 are prerequisites
for *any* SaaS shape; 2a and 2b diverge only at Phase 3+.

---

## 11. Open decisions

Resolve these before Phase 1:

1. **Product shape** — 2a (gateway) or 2b (hosted product), or 2a first then 2b?
2. **Isolation model** — pooled vs bridged vs siloed default (§5)?
3. **LTI state store** — one shared `ltijs` instance (tenant-tagged) or one per
   tenant? Verify against the installed `ltijs` version.
4. **Key management** — which KMS, and per-tenant keypair vs `kid`-partitioned
   single keyset (§6)?
5. **Identity forwarding (2a only)** — signed redirect, OIDC provider, or webhook
   (§3)?
6. **Registration UX** — manual copy-paste vs LTI Dynamic Registration (§8)?
7. **Hosting** — region(s), data residency commitments, single-region vs
   multi-region.

> None of these require code yet. This document exists so the team picks 1–7
> before the multi-tenant data model is written, because retrofitting tenant
> isolation after data exists is the expensive path.
