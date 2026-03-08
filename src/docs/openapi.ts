export function getOpenApiSpec(baseUrl?: string) {
  const server = baseUrl || "";
  return {
    openapi: "3.0.3",
    info: {
      title: "ERP API",
      version: "2.0.0",
      description:
        "Multi-tenant ERP API for daily time records, biometric integration, and company management. Deployed on AWS Lambda with Function URL.",
    },
    servers: server ? [{ url: server }] : [],
    tags: [
      { name: "Health", description: "Service health and connectivity checks" },
      { name: "Auth", description: "Sign up, sign in, password management (Cognito)" },
      { name: "User", description: "User profile management (requires token)" },
      { name: "Companies", description: "Company CRUD and invite-code joining" },
      { name: "Members", description: "Company member management (roles, status, approval)" },
      { name: "Attendance", description: "Clock in/out, attendance records, daily dashboard" },
      { name: "Devices", description: "Biometric device registration and management" },
      { name: "Webhooks", description: "Biometric device webhook endpoints" },
      { name: "Admin", description: "Platform admin and company admin operations (requires isAdmin or OWNER/ADMIN role)" },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey" as const,
          in: "header" as const,
          name: "x-api-key",
          description: "API key for device/service authentication",
        },
        BearerAuth: {
          type: "http" as const,
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Cognito access token (Authorization: Bearer <token>)",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: { type: "string" },
            message: { type: "string" },
          },
        },
        User: {
          type: "object",
          properties: {
            id: { type: "string" },
            cognitoSub: { type: "string" },
            email: { type: "string" },
            firstName: { type: "string" },
            lastName: { type: "string" },
            phone: { type: "string", nullable: true },
            avatarUrl: { type: "string", nullable: true },
            isAdmin: { type: "boolean", description: "Platform-level super admin" },
            isActive: { type: "boolean" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        Company: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            code: { type: "string", description: "6-char invite code" },
            address: { type: "string", nullable: true },
            timezone: { type: "string" },
            logoUrl: { type: "string", nullable: true },
            settings: { type: "string", nullable: true, description: "JSON string" },
            isActive: { type: "boolean" },
            ownerId: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        CompanyMember: {
          type: "object",
          properties: {
            id: { type: "string" },
            companyId: { type: "string" },
            userId: { type: "string" },
            role: { type: "string", enum: ["OWNER", "ADMIN", "MANAGER", "MEMBER"] },
            memberType: { type: "string", enum: ["EMPLOYEE", "STUDENT", "CONTRACTOR"] },
            employeeId: { type: "string", nullable: true },
            department: { type: "string", nullable: true },
            position: { type: "string", nullable: true },
            status: { type: "string", enum: ["ACTIVE", "PENDING", "INACTIVE", "SUSPENDED"] },
            joinedAt: { type: "string", format: "date-time" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        MemberWithUser: {
          allOf: [
            { $ref: "#/components/schemas/CompanyMember" },
            {
              type: "object",
              properties: {
                user: { $ref: "#/components/schemas/User" },
              },
            },
          ],
        },
        Attendance: {
          type: "object",
          properties: {
            id: { type: "string" },
            companyId: { type: "string" },
            memberId: { type: "string" },
            date: { type: "string", format: "date-time" },
            status: { type: "string", enum: ["PRESENT", "ABSENT", "LATE", "HALF_DAY", "ON_LEAVE"] },
            firstClockIn: { type: "string", format: "date-time", nullable: true },
            lastClockOut: { type: "string", format: "date-time", nullable: true },
            totalMinutes: { type: "integer", nullable: true },
            overtimeMin: { type: "integer", nullable: true },
            remarks: { type: "string", nullable: true },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        ClockEvent: {
          type: "object",
          properties: {
            id: { type: "string" },
            companyId: { type: "string" },
            memberId: { type: "string" },
            attendanceId: { type: "string", nullable: true },
            eventType: { type: "string", enum: ["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"] },
            timestamp: { type: "string", format: "date-time" },
            source: { type: "string", enum: ["BIOMETRIC", "FACIAL", "MANUAL", "WEB", "MOBILE"] },
            deviceId: { type: "string", nullable: true },
            locationLat: { type: "number", nullable: true },
            locationLng: { type: "number", nullable: true },
            photoUrl: { type: "string", nullable: true },
            remarks: { type: "string", nullable: true },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        BiometricDevice: {
          type: "object",
          properties: {
            id: { type: "string" },
            companyId: { type: "string" },
            name: { type: "string" },
            serialNumber: { type: "string", nullable: true },
            deviceType: { type: "string", enum: ["FINGERPRINT", "FACIAL_RECOGNITION", "IRIS", "RFID"] },
            location: { type: "string", nullable: true },
            apiKey: { type: "string", description: "Device key for x-device-key header" },
            isActive: { type: "boolean" },
            lastHeartbeat: { type: "string", format: "date-time", nullable: true },
            metadata: { type: "string", nullable: true },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
    security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
    paths: {
      // ─── Health ──────────────────────────────────────
      "/": {
        get: {
          tags: ["Health"],
          summary: "Root health check",
          security: [],
          responses: {
            "200": {
              description: "Service info",
              content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, service: { type: "string" }, version: { type: "string" } } } } },
            },
          },
        },
      },
      "/health": {
        get: {
          tags: ["Health"],
          summary: "Health check",
          security: [],
          responses: {
            "200": {
              description: "Service info",
              content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, service: { type: "string" }, version: { type: "string" } } } } },
            },
          },
        },
      },
      "/health/db": {
        get: {
          tags: ["Health"],
          summary: "Database connectivity check",
          security: [],
          responses: {
            "200": {
              description: "DB status with timestamps from Prisma and DSQL",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },

      // ─── Auth (public — no token required) ────────────
      "/auth/signup": {
        post: {
          tags: ["Auth"],
          summary: "Sign up a new user",
          description: "Creates a Cognito account and sends a verification code to the email. Password must be at least 8 characters with uppercase, lowercase, and a number.",
          security: [],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["email", "password", "firstName", "lastName"], properties: {
              email: { type: "string", example: "john@example.com" },
              password: { type: "string", example: "MyPass123" },
              firstName: { type: "string", example: "John" },
              lastName: { type: "string", example: "Doe" },
              phone: { type: "string", example: "+639171234567" },
            } } } },
          },
          responses: {
            "201": { description: "Sign up successful, verification code sent", content: { "application/json": { schema: { type: "object", properties: { userSub: { type: "string" }, confirmed: { type: "boolean" }, message: { type: "string" } } } } } },
            "400": { description: "Missing required fields or invalid password" },
            "409": { description: "Email already registered" },
          },
        },
      },
      "/auth/confirm": {
        post: {
          tags: ["Auth"],
          summary: "Confirm sign up (verify email)",
          description: "Verifies the email address using the 6-digit code sent during sign up.",
          security: [],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["email", "code"], properties: {
              email: { type: "string", example: "john@example.com" },
              code: { type: "string", example: "123456" },
            } } } },
          },
          responses: {
            "200": { description: "Email verified", content: { "application/json": { schema: { type: "object", properties: { confirmed: { type: "boolean" }, message: { type: "string" } } } } } },
            "400": { description: "Invalid or expired code" },
          },
        },
      },
      "/auth/resend-code": {
        post: {
          tags: ["Auth"],
          summary: "Resend verification code",
          security: [],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["email"], properties: { email: { type: "string" } } } } },
          },
          responses: {
            "200": { description: "Code resent" },
          },
        },
      },
      "/auth/login": {
        post: {
          tags: ["Auth"],
          summary: "Sign in and get tokens",
          description: "Authenticates with email/password and returns JWT tokens. On first login, automatically creates the user record in the database. Optionally pass firstName/lastName for initial DB registration.",
          security: [],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["email", "password"], properties: {
              email: { type: "string", example: "john@example.com" },
              password: { type: "string", example: "MyPass123" },
              firstName: { type: "string", description: "Used for DB user creation on first login" },
              lastName: { type: "string", description: "Used for DB user creation on first login" },
            } } } },
          },
          responses: {
            "200": { description: "Authentication successful", content: { "application/json": { schema: { type: "object", properties: {
              accessToken: { type: "string" },
              idToken: { type: "string" },
              refreshToken: { type: "string" },
              expiresIn: { type: "integer", description: "Token TTL in seconds" },
              tokenType: { type: "string", example: "Bearer" },
              user: { $ref: "#/components/schemas/User" },
            } } } } },
            "401": { description: "Invalid credentials" },
            "403": { description: "Email not verified" },
          },
        },
      },
      "/auth/refresh": {
        post: {
          tags: ["Auth"],
          summary: "Refresh access token",
          security: [],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["refreshToken"], properties: { refreshToken: { type: "string" } } } } },
          },
          responses: {
            "200": { description: "New access token", content: { "application/json": { schema: { type: "object", properties: { accessToken: { type: "string" }, idToken: { type: "string" }, expiresIn: { type: "integer" }, tokenType: { type: "string" } } } } } },
            "401": { description: "Invalid refresh token" },
          },
        },
      },
      "/auth/forgot-password": {
        post: {
          tags: ["Auth"],
          summary: "Request password reset",
          security: [],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["email"], properties: { email: { type: "string" } } } } },
          },
          responses: {
            "200": { description: "Reset code sent to email" },
            "404": { description: "User not found" },
          },
        },
      },
      "/auth/confirm-forgot-password": {
        post: {
          tags: ["Auth"],
          summary: "Reset password with code",
          security: [],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["email", "code", "newPassword"], properties: {
              email: { type: "string" },
              code: { type: "string", example: "123456" },
              newPassword: { type: "string" },
            } } } },
          },
          responses: {
            "200": { description: "Password reset successfully" },
            "400": { description: "Invalid or expired code" },
          },
        },
      },
      "/auth/change-password": {
        post: {
          tags: ["Auth"],
          summary: "Change password (requires current token)",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["previousPassword", "newPassword"], properties: {
              previousPassword: { type: "string" },
              newPassword: { type: "string" },
            } } } },
          },
          responses: {
            "200": { description: "Password changed" },
            "401": { description: "Invalid token or previous password" },
          },
        },
      },

      // ─── User profile (requires token) ────────────────
      "/auth/register": {
        post: {
          tags: ["Auth"],
          summary: "Register user (link Cognito identity to DB)",
          description: "Requires a Cognito Bearer token. Creates the User record linked to the Cognito `sub` claim. Idempotent — returns existing user if already registered.",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["firstName", "lastName"],
                  properties: {
                    firstName: { type: "string", example: "John" },
                    lastName: { type: "string", example: "Doe" },
                    phone: { type: "string", example: "+639171234567" },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "User registered (or already exists)",
              content: { "application/json": { schema: { type: "object", properties: { user: { $ref: "#/components/schemas/User" }, created: { type: "boolean" } } } } },
            },
            "400": { description: "Missing required fields or no Cognito token" },
          },
        },
      },
      "/auth/me": {
        get: {
          tags: ["Auth"],
          summary: "Get current user profile",
          description: "Returns the authenticated user's profile with company memberships. With API key auth, returns authMethod only.",
          responses: {
            "200": {
              description: "User profile with memberships",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
        put: {
          tags: ["Auth"],
          summary: "Update current user profile",
          security: [{ BearerAuth: [] }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    firstName: { type: "string" },
                    lastName: { type: "string" },
                    phone: { type: "string" },
                    avatarUrl: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Updated user", content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } },
            "401": { description: "Cognito token required" },
          },
        },
      },

      // ─── Companies ───────────────────────────────────
      "/companies": {
        post: {
          tags: ["Companies"],
          summary: "Create a company",
          description: "Creates a new company and auto-adds the authenticated user as OWNER.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: { type: "string", example: "Acme Corp" },
                    address: { type: "string", example: "123 Main St" },
                    timezone: { type: "string", example: "Asia/Manila" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Company created", content: { "application/json": { schema: { $ref: "#/components/schemas/Company" } } } },
            "400": { description: "Not registered or missing name" },
          },
        },
        get: {
          tags: ["Companies"],
          summary: "List user's companies",
          description: "Returns all companies the authenticated user is a member of (ACTIVE or PENDING).",
          responses: {
            "200": {
              description: "Array of company memberships",
              content: { "application/json": { schema: { type: "array", items: { type: "object", properties: { membership: { $ref: "#/components/schemas/CompanyMember" }, company: { $ref: "#/components/schemas/Company" } } } } } },
            },
          },
        },
      },
      "/companies/join": {
        post: {
          tags: ["Companies"],
          summary: "Join company by invite code",
          description: "Creates a PENDING membership that an admin must approve.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["code"],
                  properties: {
                    code: { type: "string", example: "A1B2C3", description: "6-char invite code" },
                    employeeId: { type: "string", example: "EMP-001" },
                    department: { type: "string", example: "Engineering" },
                    position: { type: "string", example: "Developer" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Joined successfully", content: { "application/json": { schema: { type: "object", properties: { company: { $ref: "#/components/schemas/Company" }, membership: { $ref: "#/components/schemas/CompanyMember" } } } } } },
            "400": { description: "Invalid code or already a member" },
          },
        },
      },
      "/companies/{companyId}": {
        get: {
          tags: ["Companies"],
          summary: "Get company details",
          parameters: [{ name: "companyId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Company details", content: { "application/json": { schema: { $ref: "#/components/schemas/Company" } } } },
            "404": { description: "Company not found" },
          },
        },
        put: {
          tags: ["Companies"],
          summary: "Update company (OWNER/ADMIN)",
          parameters: [{ name: "companyId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    address: { type: "string" },
                    timezone: { type: "string" },
                    logoUrl: { type: "string" },
                    settings: { type: "string", description: "JSON string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Updated company", content: { "application/json": { schema: { $ref: "#/components/schemas/Company" } } } },
            "403": { description: "Insufficient role" },
          },
        },
      },
      "/companies/{companyId}/regenerate-code": {
        post: {
          tags: ["Companies"],
          summary: "Regenerate invite code (OWNER/ADMIN)",
          parameters: [{ name: "companyId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Company with new code", content: { "application/json": { schema: { $ref: "#/components/schemas/Company" } } } },
            "403": { description: "Insufficient role" },
          },
        },
      },

      // ─── Members ─────────────────────────────────────
      "/companies/{companyId}/members": {
        get: {
          tags: ["Members"],
          summary: "List company members",
          parameters: [
            { name: "companyId", in: "path", required: true, schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string", enum: ["ACTIVE", "PENDING", "INACTIVE", "SUSPENDED"] } },
            { name: "role", in: "query", schema: { type: "string", enum: ["OWNER", "ADMIN", "MANAGER", "MEMBER"] } },
            { name: "memberType", in: "query", schema: { type: "string", enum: ["EMPLOYEE", "STUDENT", "CONTRACTOR"] } },
            { name: "search", in: "query", schema: { type: "string" }, description: "Search by employeeId, department, or position" },
          ],
          responses: {
            "200": { description: "Array of members with user info", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/MemberWithUser" } } } } },
          },
        },
      },
      "/companies/{companyId}/members/{memberId}": {
        get: {
          tags: ["Members"],
          summary: "Get member details",
          parameters: [
            { name: "companyId", in: "path", required: true, schema: { type: "string" } },
            { name: "memberId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Member with user info", content: { "application/json": { schema: { $ref: "#/components/schemas/MemberWithUser" } } } },
            "404": { description: "Member not found" },
          },
        },
        put: {
          tags: ["Members"],
          summary: "Update member (OWNER/ADMIN/MANAGER)",
          parameters: [
            { name: "companyId", in: "path", required: true, schema: { type: "string" } },
            { name: "memberId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    role: { type: "string", enum: ["OWNER", "ADMIN", "MANAGER", "MEMBER"] },
                    memberType: { type: "string", enum: ["EMPLOYEE", "STUDENT", "CONTRACTOR"] },
                    employeeId: { type: "string" },
                    department: { type: "string" },
                    position: { type: "string" },
                    status: { type: "string", enum: ["ACTIVE", "PENDING", "INACTIVE", "SUSPENDED"] },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Updated member", content: { "application/json": { schema: { $ref: "#/components/schemas/CompanyMember" } } } },
            "403": { description: "Insufficient role" },
          },
        },
      },
      "/companies/{companyId}/members/{memberId}/approve": {
        post: {
          tags: ["Members"],
          summary: "Approve a pending member (OWNER/ADMIN/MANAGER)",
          parameters: [
            { name: "companyId", in: "path", required: true, schema: { type: "string" } },
            { name: "memberId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Approved member", content: { "application/json": { schema: { $ref: "#/components/schemas/CompanyMember" } } } },
            "403": { description: "Insufficient role" },
          },
        },
      },

      // ─── Attendance / DTR ────────────────────────────
      "/companies/{companyId}/clock-in": {
        post: {
          tags: ["Attendance"],
          summary: "Clock in",
          description: "Records a CLOCK_IN event for the authenticated member. Fails if already clocked in without clocking out.",
          parameters: [{ name: "companyId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    source: { type: "string", enum: ["BIOMETRIC", "FACIAL", "MANUAL", "WEB", "MOBILE"], default: "WEB" },
                    locationLat: { type: "number", example: 14.5995 },
                    locationLng: { type: "number", example: 120.9842 },
                    photoUrl: { type: "string" },
                    remarks: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Clock event and attendance record",
              content: { "application/json": { schema: { type: "object", properties: { event: { $ref: "#/components/schemas/ClockEvent" }, attendance: { $ref: "#/components/schemas/Attendance" } } } } },
            },
            "400": { description: "Already clocked in" },
            "403": { description: "Not a member of this company" },
          },
        },
      },
      "/companies/{companyId}/clock-out": {
        post: {
          tags: ["Attendance"],
          summary: "Clock out",
          description: "Records a CLOCK_OUT event. Requires an active clock-in for today.",
          parameters: [{ name: "companyId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    source: { type: "string", enum: ["BIOMETRIC", "FACIAL", "MANUAL", "WEB", "MOBILE"], default: "WEB" },
                    locationLat: { type: "number" },
                    locationLng: { type: "number" },
                    photoUrl: { type: "string" },
                    remarks: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Clock event and updated attendance record",
              content: { "application/json": { schema: { type: "object", properties: { event: { $ref: "#/components/schemas/ClockEvent" }, attendance: { $ref: "#/components/schemas/Attendance" } } } } },
            },
            "400": { description: "No active clock-in found" },
            "403": { description: "Not a member of this company" },
          },
        },
      },
      "/companies/{companyId}/attendance": {
        get: {
          tags: ["Attendance"],
          summary: "List attendance records",
          parameters: [
            { name: "companyId", in: "path", required: true, schema: { type: "string" } },
            { name: "memberId", in: "query", schema: { type: "string" } },
            { name: "from", in: "query", schema: { type: "string", format: "date" }, description: "Start date (YYYY-MM-DD)" },
            { name: "to", in: "query", schema: { type: "string", format: "date" }, description: "End date (YYYY-MM-DD)" },
            { name: "status", in: "query", schema: { type: "string", enum: ["PRESENT", "ABSENT", "LATE", "HALF_DAY", "ON_LEAVE"] } },
          ],
          responses: {
            "200": { description: "Array of attendance records", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Attendance" } } } } },
          },
        },
      },
      "/companies/{companyId}/attendance/daily": {
        get: {
          tags: ["Attendance"],
          summary: "Daily attendance dashboard",
          description: "Returns all attendance records for a specific date, hydrated with member and user info.",
          parameters: [
            { name: "companyId", in: "path", required: true, schema: { type: "string" } },
            { name: "date", in: "query", required: true, schema: { type: "string", format: "date" }, description: "Date (YYYY-MM-DD)" },
          ],
          responses: {
            "200": { description: "Array of attendance with member/user info", content: { "application/json": { schema: { type: "array", items: { type: "object" } } } } },
            "400": { description: "Missing date parameter" },
          },
        },
      },
      "/companies/{companyId}/clock-events": {
        get: {
          tags: ["Attendance"],
          summary: "List clock events",
          parameters: [
            { name: "companyId", in: "path", required: true, schema: { type: "string" } },
            { name: "memberId", in: "query", schema: { type: "string" } },
            { name: "date", in: "query", schema: { type: "string", format: "date" } },
            { name: "attendanceId", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Array of clock events", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/ClockEvent" } } } } },
          },
        },
      },

      // ─── Devices ─────────────────────────────────────
      "/companies/{companyId}/devices": {
        get: {
          tags: ["Devices"],
          summary: "List biometric devices",
          parameters: [{ name: "companyId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Array of devices", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/BiometricDevice" } } } } },
          },
        },
        post: {
          tags: ["Devices"],
          summary: "Register a new device (OWNER/ADMIN)",
          description: "Creates a device with an auto-generated API key. Use the returned apiKey as the `x-device-key` header for biometric webhooks.",
          parameters: [{ name: "companyId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "deviceType"],
                  properties: {
                    name: { type: "string", example: "Main Entrance Scanner" },
                    deviceType: { type: "string", enum: ["FINGERPRINT", "FACIAL_RECOGNITION", "IRIS", "RFID"] },
                    serialNumber: { type: "string", example: "FP-2026-001" },
                    location: { type: "string", example: "Building A Lobby" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Device created (includes apiKey)", content: { "application/json": { schema: { $ref: "#/components/schemas/BiometricDevice" } } } },
            "400": { description: "Missing name or deviceType" },
            "403": { description: "Insufficient role" },
          },
        },
      },
      "/companies/{companyId}/devices/{deviceId}": {
        put: {
          tags: ["Devices"],
          summary: "Update device (OWNER/ADMIN)",
          parameters: [
            { name: "companyId", in: "path", required: true, schema: { type: "string" } },
            { name: "deviceId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    location: { type: "string" },
                    isActive: { type: "boolean" },
                    metadata: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Updated device", content: { "application/json": { schema: { $ref: "#/components/schemas/BiometricDevice" } } } },
            "403": { description: "Insufficient role" },
          },
        },
      },

      // ─── Webhooks ────────────────────────────────────
      "/webhook/biometric": {
        post: {
          tags: ["Webhooks"],
          summary: "Biometric device clock event",
          description: "Receives clock-in/out events from physical biometric devices. Authenticated via `x-device-key` header (not the standard API key).",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: "x-device-key", in: "header", required: true, schema: { type: "string" }, description: "Device-specific API key (from device registration)" },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["employeeId", "eventType"],
                  properties: {
                    employeeId: { type: "string", example: "EMP-001", description: "Company-issued employee ID" },
                    eventType: { type: "string", enum: ["CLOCK_IN", "CLOCK_OUT"] },
                    remarks: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Clock event recorded", content: { "application/json": { schema: { type: "object", properties: { event: { $ref: "#/components/schemas/ClockEvent" }, attendance: { $ref: "#/components/schemas/Attendance" } } } } } },
            "400": { description: "Missing fields or invalid eventType" },
            "401": { description: "Invalid or missing device key" },
            "404": { description: "Employee not found" },
          },
        },
      },

      // ─── Admin ────────────────────────────────────────
      "/admin/users": {
        get: {
          tags: ["Admin"],
          summary: "List all platform users (platform admin)",
          description: "Returns paginated list of all users. Requires platform admin (User.isAdmin=true) or API key auth.",
          parameters: [
            { name: "search", in: "query", schema: { type: "string" }, description: "Search by email, firstName, or lastName" },
            { name: "isAdmin", in: "query", schema: { type: "string", enum: ["true", "false"] } },
            { name: "isActive", in: "query", schema: { type: "string", enum: ["true", "false"] } },
            { name: "page", in: "query", schema: { type: "string" }, description: "Page number (default: 1)" },
            { name: "limit", in: "query", schema: { type: "string" }, description: "Items per page (default: 50, max: 200)" },
          ],
          responses: {
            "200": {
              description: "Paginated user list",
              content: { "application/json": { schema: { type: "object", properties: { users: { type: "array", items: { $ref: "#/components/schemas/User" } }, total: { type: "integer" }, page: { type: "integer" }, limit: { type: "integer" } } } } },
            },
            "403": { description: "Platform admin required" },
          },
        },
      },
      "/admin/users/{userId}": {
        get: {
          tags: ["Admin"],
          summary: "Get user details with memberships (platform admin)",
          parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "User with all company memberships", content: { "application/json": { schema: { type: "object" } } } },
            "403": { description: "Platform admin required" },
            "404": { description: "User not found" },
          },
        },
        put: {
          tags: ["Admin"],
          summary: "Update user (platform admin)",
          description: "Can promote/demote admin status, deactivate users, etc.",
          parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    firstName: { type: "string" },
                    lastName: { type: "string" },
                    phone: { type: "string" },
                    isAdmin: { type: "boolean" },
                    isActive: { type: "boolean" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Updated user", content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } },
            "403": { description: "Platform admin required" },
          },
        },
      },
      "/admin/companies": {
        get: {
          tags: ["Admin"],
          summary: "List all companies (platform admin)",
          parameters: [
            { name: "search", in: "query", schema: { type: "string" }, description: "Search by name or code" },
            { name: "isActive", in: "query", schema: { type: "string", enum: ["true", "false"] } },
            { name: "page", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "Paginated company list",
              content: { "application/json": { schema: { type: "object", properties: { companies: { type: "array", items: { $ref: "#/components/schemas/Company" } }, total: { type: "integer" }, page: { type: "integer" }, limit: { type: "integer" } } } } },
            },
            "403": { description: "Platform admin required" },
          },
        },
      },
      "/admin/companies/{companyId}/add-user": {
        post: {
          tags: ["Admin"],
          summary: "Add user to company (auto-creates in Cognito)",
          description: "Creates the user in Cognito (sends temp password via email), creates the DB User record, and adds them as a CompanyMember. Requires platform admin OR company OWNER/ADMIN role.",
          parameters: [{ name: "companyId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "firstName", "lastName"],
                  properties: {
                    email: { type: "string", example: "john@example.com" },
                    firstName: { type: "string", example: "John" },
                    lastName: { type: "string", example: "Doe" },
                    phone: { type: "string", example: "+639171234567" },
                    role: { type: "string", enum: ["OWNER", "ADMIN", "MANAGER", "MEMBER"], default: "MEMBER" },
                    memberType: { type: "string", enum: ["EMPLOYEE", "STUDENT", "CONTRACTOR"], default: "EMPLOYEE" },
                    employeeId: { type: "string", example: "EMP-001" },
                    department: { type: "string", example: "Engineering" },
                    position: { type: "string", example: "Developer" },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "User created and added to company",
              content: { "application/json": { schema: { type: "object", properties: { user: { $ref: "#/components/schemas/User" }, member: { $ref: "#/components/schemas/CompanyMember" }, cognitoCreated: { type: "boolean" } } } } },
            },
            "400": { description: "Missing required fields, company not found, or user already a member" },
            "403": { description: "Insufficient permissions" },
          },
        },
      },
    },
  };
}
