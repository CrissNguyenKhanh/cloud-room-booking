import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  FRONTEND_ORIGIN: z.string().url(),
  NOTIFICATION_DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  INTERNAL_SERVICE_KEY: z.string().min(24)
});

export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid notification-service environment: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const value = parsed.data;
  return { nodeEnv: value.NODE_ENV, port: value.PORT, frontendOrigin: value.FRONTEND_ORIGIN,
    databaseUrl: value.NOTIFICATION_DATABASE_URL, jwtSecret: value.JWT_SECRET, jwtIssuer: value.JWT_ISSUER,
    jwtAudience: value.JWT_AUDIENCE, internalServiceKey: value.INTERNAL_SERVICE_KEY, serviceName: 'notification-service' };
}
