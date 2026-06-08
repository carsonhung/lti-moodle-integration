-- LTI 1.3 schema (Postgres) — two tables for binding LMS contexts to your app.
--
-- Adjust the foreign-key references (courses, resources, categories, groups,
-- users) to match your application's table names. The "tenant_id" columns are
-- optional and can stay NULL for single-tenant apps.
--
-- NOTE: lti_resource_bindings applies to the `deep-linking` connect mode only
-- (see LTI_CONNECT_MODES in shared/lti.ts), where a teacher binds an activity to
-- a specific resource via Moodle's content picker. The HKU Group Signup Moodle
-- deployment does NOT use Deep Linking — it runs in `context-mapping` (using
-- lti_course_maps) or `login-only`, so lti_resource_bindings is inactive on the
-- Moodle path. Keep that table only if/when Deep Linking is enabled.

-- ─── lti_course_maps ────────────────────────────────────────────────────────
-- One row per LMS course (issuer + client_id + deployment_id + context_id).
-- Maps a Moodle course to a course in your application.

CREATE TABLE IF NOT EXISTS lti_course_maps (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issuer          TEXT NOT NULL,
    client_id       TEXT NOT NULL,
    deployment_id   TEXT NOT NULL,
    context_id      TEXT NOT NULL,
    course_id       UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    tenant_id       TEXT,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT lti_course_maps_context_uq UNIQUE (issuer, client_id, deployment_id, context_id)
);

CREATE INDEX IF NOT EXISTS lti_course_maps_tenant_idx ON lti_course_maps (tenant_id);

-- ─── lti_resource_bindings ──────────────────────────────────────────────────
-- One row per LMS activity (resource_link_id). Stores which resource
-- (single agent/bot/tool), category, OR group should be launched.
-- The 'group' binding is a domain-specific example (HKU Group Signup); 'agent'
-- and 'category' are the generic template examples.
--
-- A binding targets exactly ONE row (one agent, one category, or one group). To
-- launch MULTIPLE resources from a single activity, use the 'category' binding:
-- point it at a category that contains the resources you want, rather than
-- binding the activity to many resources directly.

CREATE TABLE IF NOT EXISTS lti_resource_bindings (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issuer            TEXT NOT NULL,
    client_id         TEXT NOT NULL,
    deployment_id     TEXT NOT NULL,
    context_id        TEXT NOT NULL,
    resource_link_id  TEXT NOT NULL,
    course_id         UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    -- Exactly one of resource_id / category_id / group_id should be set, matching binding_type.
    resource_id       UUID REFERENCES resources(id) ON DELETE CASCADE,
    category_id       UUID REFERENCES categories(id) ON DELETE CASCADE,
    group_id          UUID REFERENCES groups(id) ON DELETE CASCADE,
    binding_type      TEXT NOT NULL DEFAULT 'agent', -- 'agent' | 'category' | 'group'
    tenant_id         TEXT,
    created_by        UUID NOT NULL REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT lti_resource_bindings_link_uq UNIQUE (
        issuer, client_id, deployment_id, context_id, resource_link_id
    ),
    CONSTRAINT lti_resource_bindings_type_check CHECK (
        (binding_type = 'agent' AND resource_id IS NOT NULL)
     OR (binding_type = 'category' AND category_id IS NOT NULL)
     OR (binding_type = 'group' AND group_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS lti_resource_bindings_tenant_idx ON lti_resource_bindings (tenant_id);
CREATE INDEX IF NOT EXISTS lti_resource_bindings_course_idx ON lti_resource_bindings (course_id);
