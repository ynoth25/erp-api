/**
 * Cognito JWT verification (Lambda-safe).
 *
 * Validates access tokens issued by AWS Cognito User Pool.
 * Uses the `jose` library to fetch JWKS and verify JWT signatures.
 * JWKS is cached in memory (survives across Lambda invocations in the same container).
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface CognitoUser {
  sub: string;
  email?: string;
  username?: string;
  groups?: string[];
  tokenUse: string;
}

let cachedJWKS: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS(): ReturnType<typeof createRemoteJWKSet> {
  if (cachedJWKS) return cachedJWKS;

  const region = process.env.COGNITO_REGION;
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  if (!region || !userPoolId) {
    throw new Error("COGNITO_REGION and COGNITO_USER_POOL_ID must be set");
  }

  const jwksUrl = new URL(
    `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`
  );
  cachedJWKS = createRemoteJWKSet(jwksUrl);
  return cachedJWKS;
}

/**
 * Verify a Cognito access token (from `Authorization: Bearer <token>`).
 *
 * Checks:
 *  - JWT signature against Cognito JWKS (RS256)
 *  - Issuer matches the User Pool
 *  - token_use is "access"
 *  - Token is not expired
 *
 * Returns the decoded user info or throws on failure.
 */
export async function verifyCognitoToken(token: string): Promise<CognitoUser> {
  const region = process.env.COGNITO_REGION;
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;

  const jwks = getJWKS();

  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    algorithms: ["RS256"],
  });

  if (payload.token_use !== "access") {
    throw new Error(`Expected token_use "access", got "${payload.token_use}"`);
  }

  return extractUser(payload);
}

function extractUser(payload: JWTPayload): CognitoUser {
  return {
    sub: payload.sub!,
    email: payload.email as string | undefined,
    username: payload["cognito:username"] as string | undefined,
    groups: payload["cognito:groups"] as string[] | undefined,
    tokenUse: payload.token_use as string,
  };
}
