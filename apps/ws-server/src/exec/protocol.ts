import {
  type ExecMessage,
  LANGUAGES,
  type LanguageId,
  MAX_CODE_BYTES,
  MAX_NAME_LENGTH,
  MAX_STDIN_BYTES,
  byteLength,
  sanitizeName,
} from '@sandbox/shared';
import { z } from 'zod';

const LANGUAGE_IDS = Object.keys(LANGUAGES) as [LanguageId, ...LanguageId[]];

/** Bytes, not `.length`: an emoji is 4 bytes but 2 UTF-16 code units, and a cap must not be foolable. */
const withinBytes = (limit: number) => (value: string) => byteLength(value) <= limit;

const userSchema = z.object({
  id: z.string().min(1).max(64),
  name: z
    .string()
    .max(200)
    .transform(sanitizeName)
    .refine((name) => name.length > 0 && name.length <= MAX_NAME_LENGTH, 'name is empty'),
  // The colour reaches every other client, and Phase 1 interpolates it straight into CSS.
  // A hex colour, or nothing.
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const runRequestSchema = z.object({
  type: z.literal('run'),
  byUser: userSchema,
  fileName: z.string().min(1).max(128),
  language: z.enum(LANGUAGE_IDS),
  code: z.string().refine(withinBytes(MAX_CODE_BYTES), `code exceeds ${MAX_CODE_BYTES} bytes`),
  stdin: z.string().refine(withinBytes(MAX_STDIN_BYTES), `stdin exceeds ${MAX_STDIN_BYTES} bytes`),
});

export type ParsedRunRequest = z.infer<typeof runRequestSchema>;

/**
 * Throws on anything malformed. The caller closes the socket — it never coerces a bad message
 * into a plausible one.
 */
export const parseRunRequest = (raw: string): ParsedRunRequest =>
  runRequestSchema.parse(JSON.parse(raw));

export const encode = (message: ExecMessage): string => JSON.stringify(message);
