import * as path from "node:path";
import { defineConfig } from "prisma/config";

async function getDatabaseUrl(): Promise<string> {
  const host = process.env.DSQL_HOST;
  if (!host) {
    return "postgresql://localhost:5432/postgres";
  }

  const { DsqlSigner } = await import("@aws-sdk/dsql-signer");

  const user = process.env.DSQL_USER ?? "admin";
  const region = process.env.DSQL_REGION ?? "ap-northeast-1";
  const database = process.env.DSQL_DATABASE ?? "postgres";

  const signer = new DsqlSigner({ hostname: host, region });
  const token =
    user === "admin"
      ? await signer.getDbConnectAdminAuthToken()
      : await signer.getDbConnectAuthToken();
  const encodedToken = encodeURIComponent(token);

  return `postgresql://${user}:${encodedToken}@${host}:5432/${database}?sslmode=require`;
}

export default defineConfig({
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  migrations: {
    path: path.join(__dirname, "prisma", "migrations"),
  },
  datasource: {
    url: await getDatabaseUrl(),
  },
});
