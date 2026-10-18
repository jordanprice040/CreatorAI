import { z, parse } from '@creator/contracts';
const port = z
  .string()
  .regex(/^[1-9][0-9]{0,4}$/)
  .transform(Number)
  .pipe(z.number().int().min(1024).max(65535));
export const ServiceConfigSchema = z
  .strictObject({
    host: z.literal('127.0.0.1'),
    api_port: port,
    web_port: port,
    deployment_mode: z.literal('local'),
    data_mode: z.literal('fixture'),
    provider: z.literal('fixture'),
    live_enabled: z.literal('false'),
  })
  .refine((c) => c.api_port !== c.web_port, 'API and web ports must differ.');
export function serviceConfig(env: Record<string, string | undefined>) {
  return parse(
    ServiceConfigSchema,
    {
      host: env.CREATOR_HOST ?? '127.0.0.1',
      api_port: env.CREATOR_API_PORT ?? '4310',
      web_port: env.CREATOR_WEB_PORT ?? '5173',
      deployment_mode: env.CREATOR_DEPLOYMENT_MODE ?? 'local',
      data_mode: env.CREATOR_DATA_MODE ?? 'fixture',
      provider: env.CREATOR_PROVIDER ?? 'fixture',
      live_enabled: env.CREATOR_LIVE_ENABLED ?? 'false',
    },
    'INVALID_CONFIG',
  );
}
export type ServiceConfig = ReturnType<typeof serviceConfig>;
