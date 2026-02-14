# ERP API

Node.js TypeScript Lambda app with **Lambda Function URL** and **CloudWatch log retention set to 1 day**.

## Prerequisites

- Node.js 20+
- AWS SAM CLI ([Install](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html))
- AWS CLI configured with credentials

## Setup

```bash
npm install
npm run prisma:generate
```

Copy `.env.example` to `.env` and set `DATABASE_URL` (PostgreSQL). For local dev with SQLite, change `prisma/schema.prisma` datasource to `provider = "sqlite"` and `url = "file:./dev.db"`, then run `npm run prisma:push`.

## Build (local TypeScript)

```bash
npm run build
```

## Deploy to AWS

1. Build the Lambda (uses Makefile; includes Prisma and node_modules). On **Windows**, use Docker so `make` runs in a Linux container:

   ```bash
   sam build --use-container
   ```

   On Linux/macOS: `sam build`.

2. Deploy (first time use `--guided`; you’ll be prompted for `DatabaseUrl` for Prisma):

   ```bash
   sam deploy --guided
   ```

   Later: `sam deploy`.

After deployment, the **Function URL** is printed in the stack outputs (e.g. `ApiFunctionUrl`). Use it to call the API:

- `GET <url>/` or `GET <url>/health` → JSON health response

## Features

- **Runtime:** Node.js 20.x
- **Invocation:** Lambda Function URL (HTTP) — no API Gateway required
- **Logs:** CloudWatch log group `/aws/lambda/erp-api` with **retention 1 day**
- **CORS:** Enabled for common methods/headers (customize in `template.yaml` if needed)

## Prisma

- **Generate client:** `npm run prisma:generate`
- **Migrations:** `npm run prisma:migrate`
- **Push schema (no migrations):** `npm run prisma:push`
- **Studio:** `npm run prisma:studio`

Use the singleton `prisma` from `src/lib/prisma.ts` in your handlers (Lambda-safe).

## Aurora DSQL

The app can connect to **Amazon Aurora DSQL** using IAM authentication (no password in env). Set `DSQL_HOST` and `DSQL_USER` (see `.env.example`). In Lambda, set the SAM parameters `DsqlHost`, `DsqlUser`, `DsqlDatabase`, `DsqlRegion`, and `DsqlClusterArn` so the function gets the right env and IAM (`dsql:DbConnect` / `dsql:DbConnectAdmin`).

- **Pool (Lambda-safe):** `import { getAuroraDsqlPool } from "./lib/aurora-dsql"; const pool = getAuroraDsqlPool(); await pool.query("SELECT NOW()");`
- **Helper:** `import { queryAuroraDsql } from "./lib/aurora-dsql"; const result = await queryAuroraDsql("SELECT 1");` (returns `null` if DSQL is not configured)
- **Check config:** `import { isAuroraDsqlConfigured } from "./lib/aurora-dsql";`

[Amazon Aurora DSQL](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/) uses the `@aws/aurora-dsql-node-postgres-connector` (node-postgres with IAM tokens).

## Project layout

- `src/index.ts` – Lambda handler (payload 2.0, compatible with Function URL and HTTP API)
- `src/lib/prisma.ts` – Singleton Prisma client for Lambda and local dev
- `src/lib/aurora-dsql.ts` – Aurora DSQL pool and helpers (IAM auth)
- `prisma/schema.prisma` – Schema and migrations (binary targets: native + Lambda)
- `template.yaml` – SAM template (function, Function URL, log group 1-day retention)
- `tsconfig.json` – TypeScript config for local build

## Optional: switch to API Gateway HTTP API

To use API Gateway HTTP API instead of a Function URL, replace `FunctionUrlConfig` in `template.yaml` with an `AWS::Serverless::HttpApi` and wire the function as the default route. The same handler works for both.
