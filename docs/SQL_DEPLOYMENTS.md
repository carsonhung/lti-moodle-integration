# SQL-backed deployments (`ltijs-sequelize`)

Run without MongoDB by giving ltijs a SQL database plugin.


`ltijs` defaults to MongoDB for its own internal bookkeeping — registered platforms, OIDC nonces, the tool's own JWK keypair, idtoken cache, etc. Projects that don't want to run a MongoDB instance can swap that out for a SQL database by passing a `dbPlugin` instance instead of a `dbUrl`. The integration point on the module side is already there:

```ts
await initLti(app, adapter, {
  mountPath: '/api/v1/lti',
  dbPlugin: mySqlPlugin,   // takes precedence over dbUrl / LTI_DB_URL
});
```

The plugin must implement the `LtiDatabasePlugin` shape exported from `./types` (`setup`, `Get`, `Insert`, `Modify`, `Delete` — MongoDB-document-oriented). The simplest path is the **official community plugin** [`ltijs-sequelize`](https://www.npmjs.com/package/ltijs-sequelize), which implements that contract over Postgres / MySQL / MariaDB / MSSQL / SQLite via Sequelize.

**Install the plugin + the SQL driver for your DB:**

```bash
npm install ltijs-sequelize sequelize pg            # Postgres
# or: npm install ltijs-sequelize sequelize mysql2  # MySQL / MariaDB
# or: npm install ltijs-sequelize sequelize sqlite3 # SQLite (great for dev)
```

**Wire it up:**

```ts
import { initLti } from 'lti-moodle-integration/backend';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database = require('ltijs-sequelize');

const ltiDb = new Database(
  process.env.LTI_DB_NAME ?? 'lti',
  process.env.LTI_DB_USER,
  process.env.LTI_DB_PASS,
  {
    host: process.env.LTI_DB_HOST,
    dialect: 'postgres',
    logging: false,
  },
);

await initLti(app, adapter, {
  mountPath: '/api/v1/lti',
  dbPlugin: ltiDb,        // skip LTI_DB_URL — ltijs uses the plugin instead
  skipDeepLinking: true,  // optional, see "Login-only mode" below
});
```

`ltijs-sequelize` creates and manages its own tables (`idtoken`, `nonce`, `platform`, `accesstoken`, etc.) using Sequelize migrations — it does **not** know about your project's Drizzle / Prisma / TypeORM schema, and it doesn't need to. They coexist peacefully in the same Postgres instance. If you'd prefer the LTI tables to live in their own logical database (recommended for isolation), point `LTI_DB_NAME` at a separate DB and ensure your DB user can `CREATE TABLE` in it.

Your business-data tables (the ones backing `LtiCourseMap` and `LtiResourceLinkBinding` — what your *adapter* persists to record course mappings and resource bindings) are independent of ltijs's plugin: you keep using whatever ORM you already use for those, via the adapters in `backend/src/adapters/`.
