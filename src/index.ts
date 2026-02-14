import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context,
} from "aws-lambda";

/**
 * Lambda handler for Function URL or API Gateway HTTP API (payload 2.0).
 * Use this handler in SAM/CloudFormation with FunctionUrlConfig or HTTP API.
 */
export async function handler(
  event: APIGatewayProxyEventV2,
  _context: Context
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext?.http?.method ?? "GET";
  const path = event.rawPath ?? event.requestContext?.http?.path ?? "/";

  if (path === "/" || path === "/health") {
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        service: "erp-api",
        path,
        method,
      }),
    };
  }

  return {
    statusCode: 404,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ error: "Not Found", path, method }),
  };
}
