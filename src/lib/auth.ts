import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { verifyCognitoToken, type CognitoUser } from "./cognito";
import { getPrisma } from "./prisma";

export interface AuthResult {
  authorized: boolean;
  error?: string;
  /** Set when authenticated via Cognito JWT */
  user?: CognitoUser;
  /** How the request was authenticated */
  authMethod?: "cognito" | "api-key";
  /** Platform-level super-admin flag */
  isAdmin?: boolean;
  /** Resolved DB user id (set for Cognito-authenticated requests) */
  userId?: string;
}

/**
 * Authenticate the request via Cognito Bearer token or API key.
 * For Cognito users, also resolves the DB user to populate isAdmin/userId.
 */
export async function authorize(event: APIGatewayProxyEventV2): Promise<AuthResult> {
  const path = event.rawPath ?? "/";

  if (path === "/" || path === "/health") {
    return { authorized: true };
  }

  // --- 1. Try Cognito Bearer token ---
  const authHeader = event.headers?.["authorization"] ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    try {
      const user = await verifyCognitoToken(token);
      const prisma = await getPrisma();
      const dbUser = await prisma.user.findFirst({ where: { cognitoSub: user.sub } });
      return {
        authorized: true,
        user,
        authMethod: "cognito",
        isAdmin: dbUser?.isAdmin ?? false,
        userId: dbUser?.id ?? undefined,
      };
    } catch (err) {
      return {
        authorized: false,
        error: `Invalid token: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // --- 2. Try API key ---
  const requestKey = event.headers?.["x-api-key"] ?? "";
  if (requestKey) {
    const apiKeysEnv = process.env.API_KEYS ?? "";
    const validKeys = apiKeysEnv.split(",").map((k) => k.trim()).filter(Boolean);

    if (validKeys.length === 0) {
      return { authorized: false, error: "API keys not configured on server" };
    }
    if (!validKeys.includes(requestKey)) {
      return { authorized: false, error: "Invalid API key" };
    }

    const origin = event.headers?.["origin"];
    if (origin) {
      const allowedOriginsEnv = process.env.ALLOWED_ORIGINS ?? "";
      const allowedOrigins = allowedOriginsEnv.split(",").map((o) => o.trim()).filter(Boolean);
      if (allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
        return { authorized: false, error: "Origin not allowed" };
      }
    }

    return { authorized: true, authMethod: "api-key", isAdmin: true };
  }

  return { authorized: false, error: "Missing Authorization header or x-api-key" };
}

/**
 * Build CORS headers.
 */
export function getCorsHeaders(event: APIGatewayProxyEventV2): Record<string, string> {
  const origin = event.headers?.["origin"] ?? "";
  const allowedOriginsEnv = process.env.ALLOWED_ORIGINS ?? "";
  const allowedOrigins = allowedOriginsEnv.split(",").map((o) => o.trim()).filter(Boolean);

  const allowedOrigin =
    allowedOrigins.length === 0
      ? "*"
      : allowedOrigins.includes(origin)
        ? origin
        : "null";

  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, x-api-key, x-device-key, authorization",
    "access-control-max-age": "86400",
  };
}
