import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  CHROME_PORTABLE_PATH: z.string().min(1),
  CHROME_PROFILE_DIR: z.string().min(1),
  GMAIL_URL: z.string().url().default('https://mail.google.com/mail/u/0/#all'),
  BROWSER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  FETCH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(90000)
});
export type Config = z.infer<typeof schema>;
export function loadConfig(): Config { return schema.parse(process.env); }
