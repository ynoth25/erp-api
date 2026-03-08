import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  ResendConfirmationCodeCommand,
  ChangePasswordCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { getPrisma } from "../lib/prisma";
import { verifyCognitoToken } from "../lib/cognito";

const cognito = new CognitoIdentityProviderClient({
  region: process.env.COGNITO_REGION ?? "ap-northeast-1",
});

function getClientId(): string {
  const id = process.env.COGNITO_CLIENT_ID;
  if (!id) throw new Error("COGNITO_CLIENT_ID not configured");
  return id;
}

export async function signUp(data: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
}) {
  const result = await cognito.send(
    new SignUpCommand({
      ClientId: getClientId(),
      Username: data.email,
      Password: data.password,
      UserAttributes: [
        { Name: "email", Value: data.email },
        { Name: "name", Value: `${data.firstName} ${data.lastName}` },
      ],
    })
  );

  return {
    userSub: result.UserSub,
    confirmed: result.UserConfirmed ?? false,
    message: result.UserConfirmed
      ? "Account created and confirmed"
      : "Verification code sent to your email",
  };
}

export async function confirmSignUp(data: { email: string; code: string }) {
  await cognito.send(
    new ConfirmSignUpCommand({
      ClientId: getClientId(),
      Username: data.email,
      ConfirmationCode: data.code,
    })
  );
  return { confirmed: true, message: "Email verified successfully" };
}

export async function resendConfirmation(data: { email: string }) {
  await cognito.send(
    new ResendConfirmationCodeCommand({
      ClientId: getClientId(),
      Username: data.email,
    })
  );
  return { message: "Verification code resent to your email" };
}

/**
 * Authenticate with Cognito and auto-register the DB user on first login.
 * Returns access/refresh/id tokens plus the DB user profile.
 */
export async function signIn(data: {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}) {
  const result = await cognito.send(
    new InitiateAuthCommand({
      ClientId: getClientId(),
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: {
        USERNAME: data.email,
        PASSWORD: data.password,
      },
    })
  );

  const tokens = result.AuthenticationResult;
  if (!tokens?.AccessToken) {
    if (result.ChallengeName) {
      return {
        challenge: result.ChallengeName,
        session: result.Session,
        message: `Authentication challenge: ${result.ChallengeName}`,
      };
    }
    throw new Error("Authentication failed — no tokens returned");
  }

  const cognitoUser = await verifyCognitoToken(tokens.AccessToken);

  const prisma = await getPrisma();
  let dbUser = await prisma.user.findFirst({
    where: { cognitoSub: cognitoUser.sub },
  });

  if (!dbUser) {
    dbUser = await prisma.user.create({
      data: {
        cognitoSub: cognitoUser.sub,
        email: cognitoUser.email ?? cognitoUser.username ?? data.email,
        firstName: data.firstName ?? data.email.split("@")[0],
        lastName: data.lastName ?? "",
      },
    });
  }

  return {
    accessToken: tokens.AccessToken,
    idToken: tokens.IdToken,
    refreshToken: tokens.RefreshToken,
    expiresIn: tokens.ExpiresIn,
    tokenType: tokens.TokenType ?? "Bearer",
    user: dbUser,
  };
}

export async function refreshToken(data: { refreshToken: string }) {
  const result = await cognito.send(
    new InitiateAuthCommand({
      ClientId: getClientId(),
      AuthFlow: "REFRESH_TOKEN_AUTH",
      AuthParameters: {
        REFRESH_TOKEN: data.refreshToken,
      },
    })
  );

  const tokens = result.AuthenticationResult;
  if (!tokens?.AccessToken) {
    throw new Error("Token refresh failed");
  }

  return {
    accessToken: tokens.AccessToken,
    idToken: tokens.IdToken,
    expiresIn: tokens.ExpiresIn,
    tokenType: tokens.TokenType ?? "Bearer",
  };
}

export async function forgotPassword(data: { email: string }) {
  await cognito.send(
    new ForgotPasswordCommand({
      ClientId: getClientId(),
      Username: data.email,
    })
  );
  return { message: "Password reset code sent to your email" };
}

export async function confirmForgotPassword(data: {
  email: string;
  code: string;
  newPassword: string;
}) {
  await cognito.send(
    new ConfirmForgotPasswordCommand({
      ClientId: getClientId(),
      Username: data.email,
      ConfirmationCode: data.code,
      Password: data.newPassword,
    })
  );
  return { message: "Password reset successfully" };
}

export async function changePassword(data: {
  accessToken: string;
  previousPassword: string;
  newPassword: string;
}) {
  await cognito.send(
    new ChangePasswordCommand({
      AccessToken: data.accessToken,
      PreviousPassword: data.previousPassword,
      ProposedPassword: data.newPassword,
    })
  );
  return { message: "Password changed successfully" };
}
