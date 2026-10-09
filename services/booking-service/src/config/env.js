import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  FRONTEND_ORIGIN: z.string().url(),
  BOOKING_DATABASE_URL: z.string().min(1),
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(10000),
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  INTERNAL_SERVICE_KEY: z.string().min(24),
  IDENTITY_SERVICE_URL: z.string().url(),
  NOTIFICATION_SERVICE_URL: z.string().url(),
  IDENTITY_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
  NOTIFICATION_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().max(20).default(5),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().max(100).default(20),
});

export function loadConfig(env = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid booking-service environment: ${details}`);
  }
  const data = result.data;
  return {
    nodeEnv: data.NODE_ENV,
    port: data.PORT,
    frontendOrigin: data.FRONTEND_ORIGIN,
    databaseUrl: data.BOOKING_DATABASE_URL,
    databaseConnectionTimeoutMs: data.DATABASE_CONNECTION_TIMEOUT_MS,
    jwtSecret: data.JWT_SECRET,
    jwtIssuer: data.JWT_ISSUER,
    jwtAudience: data.JWT_AUDIENCE,
    internalServiceKey: data.INTERNAL_SERVICE_KEY,
    identityServiceUrl: data.IDENTITY_SERVICE_URL,
    notificationServiceUrl: data.NOTIFICATION_SERVICE_URL,
    identityTimeoutMs: data.IDENTITY_TIMEOUT_MS,
    notificationTimeoutMs: data.NOTIFICATION_TIMEOUT_MS,
    outboxMaxAttempts: data.OUTBOX_MAX_ATTEMPTS,
    outboxBatchSize: data.OUTBOX_BATCH_SIZE,
    serviceName: "booking-service",
  };
}
