/**
 * Local dev server: turns HTTP requests into Lambda payload 2.0 events
 * and runs the same handler as in Lambda. Use `npm run dev`.
 */
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handler } from "./index";

const PORT = Number(process.env.PORT) || 3000;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function buildLambdaEvent(req: IncomingMessage, body: string): import("aws-lambda").APIGatewayProxyEventV2 {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  return {
    version: "2.0",
    routeKey: `${req.method} ${url.pathname}`,
    rawPath: url.pathname,
    rawQueryString: url.searchParams.toString(),
    headers: (req.headers as Record<string, string>) ?? {},
    requestContext: {
      accountId: "local",
      apiId: "local",
      domainName: "localhost",
      domainPrefix: "localhost",
      http: {
        method: req.method ?? "GET",
        path: url.pathname,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: req.headers["user-agent"] ?? "",
      },
      requestId: "local-" + Date.now(),
      routeKey: `${req.method} ${url.pathname}`,
      stage: "local",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    body: body || undefined,
    isBase64Encoded: false,
    pathParameters: undefined,
    stageVariables: undefined,
    queryStringParameters: url.searchParams.toString()
      ? Object.fromEntries(url.searchParams.entries())
      : undefined,
    cookies: undefined,
  };
}

const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const body = await readBody(req);
  const event = buildLambdaEvent(req, body);

  try {
    const result = await handler(event, {} as import("aws-lambda").Context);
    const out = typeof result === "string" ? { statusCode: 200, body: result } : result;
    res.writeHead(out.statusCode ?? 200, (out.headers as Record<string, string>) ?? {});
    res.end(out.body ?? "");
  } catch (err) {
    console.error(err);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Internal Server Error", message: String(err) }));
  }
});

server.listen(PORT, () => {
  console.log(`ERP API dev server: http://localhost:${PORT}`);
  console.log(`  GET / or GET /health → health check`);
});
