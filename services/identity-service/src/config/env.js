import { z } from "zod";
import "dotenv/config";
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  FRONTEND_ORIGIN: z.string().url(),
  IDENTITY_DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  JWT_EXPIRES_IN: z.string().min(1).default("1h"),
  INTERNAL_SERVICE_KEY: z.string().min(24),
});

export function loadConfig(env = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid identity-service environment: ${details}`);
  }
  return {
    nodeEnv: result.data.NODE_ENV,
    port: result.data.PORT,
    frontendOrigin: result.data.FRONTEND_ORIGIN,
    databaseUrl: result.data.IDENTITY_DATABASE_URL,
    jwtSecret: result.data.JWT_SECRET,
    jwtIssuer: result.data.JWT_ISSUER,
    jwtAudience: result.data.JWT_AUDIENCE,
    jwtExpiresIn: result.data.JWT_EXPIRES_IN,
    internalServiceKey: result.data.INTERNAL_SERVICE_KEY,
    serviceName: "identity-service",
  };
}
