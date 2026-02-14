import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context,
} from "aws-lambda";
import { getPrisma } from "./lib/prisma";
import { queryDsql } from "./lib/aurora-dsql";

/**
 * Lambda handler for HTTP API (API Gateway v2 payload 2.0).
 */
export async function handler(
  event: APIGatewayProxyEventV2,
  _context: Context
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext?.http?.method ?? "GET";
  const path = event.rawPath ?? event.requestContext?.http?.path ?? "/";

  try {
    // Health check
    if (path === "/" || path === "/health") {
      return json(200, { ok: true, service: "erp-api", path, method });
    }

    // DB health check — verifies both Prisma and raw DSQL connections
    if (path === "/health/db") {
      const prisma = await getPrisma();
      const prismaResult = await prisma.$queryRaw<{ now: Date }[]>`SELECT NOW()`;

      const dsqlResult = await queryDsql<{ now: Date }>("SELECT NOW()");

      return json(200, {
        ok: true,
        prisma: { connected: true, now: prismaResult[0]?.now },
        dsql: { connected: true, now: dsqlResult.rows[0]?.now },
      });
    }

    // Example: list users via Prisma
    if (path === "/users" && method === "GET") {
      const prisma = await getPrisma();
      const users = await prisma.user.findMany();
      return json(200, { users });
    }

    return json(404, { error: "Not Found", path, method });
  } catch (err) {
    console.error("Handler error:", err);
    return json(500, {
      error: "Internal Server Error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}
