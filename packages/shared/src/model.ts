export const SCHEMA_VERSION = 1;
export const ROOM_ID_LENGTH = 10;
export const MAX_NAME_LENGTH = 24;

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{6,32}$/;

export const isValidRoomId = (id: string | undefined): id is string =>
  typeof id === 'string' && ROOM_ID_PATTERN.test(id);

export const sanitizeName = (raw: string): string =>
  raw
    .replace(/[^\p{L}\p{N} _.\-]/gu, '')
    .slice(0, MAX_NAME_LENGTH)
    .trim();

/** `main.py` + `.js` → `main.js`. `dot > 0`, not `>= 0`, so `.env` keeps its leading dot as the stem. */
export const renameExtension = (name: string, extension: string): string => {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}${extension}`;
};

export const LANGUAGES = {
  python: { label: 'Python', monaco: 'python', extension: '.py' },
  javascript: { label: 'JavaScript', monaco: 'javascript', extension: '.js' },
  typescript: { label: 'TypeScript', monaco: 'typescript', extension: '.ts' },
} as const;

export type LanguageId = keyof typeof LANGUAGES;

/** Derived from LANGUAGES so the two can never disagree. */
export const EXTENSION_TO_LANGUAGE: Record<string, LanguageId> = Object.fromEntries(
  Object.entries(LANGUAGES).map(([id, { extension }]) => [extension, id as LanguageId]),
);

/**
 * The filename is the single source of truth for the language: Piston keys off the extension,
 * so a `main.py` holding TypeScript will not compile. `undefined` is not an error — the file
 * edits, syncs and is drawn on like any other; it simply has no runtime, and Run is disabled.
 *
 * `dot > 0`, not `>= 0`, matches renameExtension: `.py` is a dotfile whose stem is `.py`, not a
 * Python file with an empty name.
 */
export const languageForName = (name: string): LanguageId | undefined => {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return undefined;

  return EXTENSION_TO_LANGUAGE[name.slice(dot).toLowerCase()];
};

export const MAX_FILE_NAME_LENGTH = 32;

/**
 * Guards the create/rename UI. Returns an error message, or null when the name is usable.
 *
 * Uniqueness here is a UI guard and cannot be a doc invariant: two peers renaming concurrently
 * both see a free name, and both writes land. That duplicate is tolerated — files are keyed by
 * id, so it is cosmetic — and never auto-resolved, which would be a write-back race.
 */
export const validateFileName = (name: string, existingNames: string[]): string | null => {
  const trimmed = name.trim();

  if (!trimmed) return 'Name cannot be empty';
  if (trimmed.length > MAX_FILE_NAME_LENGTH) return `Name is too long (max ${MAX_FILE_NAME_LENGTH})`;
  if (trimmed.includes('/') || trimmed.includes('..')) return 'Name cannot contain / or ..';
  if (trimmed.includes('\\')) return 'Name cannot contain \\';

  const taken = existingNames.some((existing) => existing.toLowerCase() === trimmed.toLowerCase());
  return taken ? 'That name is already taken' : null;
};

/**
 * There is deliberately no `language` field. The name is the single source of truth — see
 * `languageForName`. A stored language would be a second thing that could disagree with the
 * extension Piston actually keys off.
 *
 * Rooms persisted before this change still carry a `language` key inside their stored FileMeta.
 * It is inert: we simply stop reading it, so no migration and no SCHEMA_VERSION bump.
 */
export type FileMeta = {
  id: string;
  name: string;
  createdAt: number;
};

export type Point = { x: number; y: number; p?: number };

export type Shape =
  | { kind: 'freehand'; points: Point[] }
  | { kind: 'arrow'; from: Point; to: Point }
  | { kind: 'rect'; from: Point; to: Point }
  | { kind: 'text'; at: Point; text: string };

export type Stroke = {
  id: string;
  fileId: string;
  authorId: string;
  color: string;
  width: number;
  shape: Shape;
  /** Phase 5. `rel` is a base64-encoded Yjs relative position into the file's Y.Text. */
  anchor?: { rel: string; dy: number };
  createdAt: number;
};

/** The one stroke width. There is no width UI in Phase 3 — a width picker is a later additive change. */
export const STROKE_WIDTH = 3;

/** The in-progress stroke, broadcast over awareness while drawing and cleared on pointer-up. */
export type DraftStroke = {
  fileId: string;
  color: string;
  width: number;
  shape: Shape;
};

export type User = { id: string; name: string; color: string };

/** y-monaco writes its own `selection` field (Yjs relative positions) into awareness. */
export type AwarenessState = {
  user: User;
  activeFileId: string;
  pointer?: { fileId: string; x: number; y: number };
  draft?: DraftStroke;
};

export const DOC_FILES_KEY = 'files';
export const DOC_STROKES_KEY = 'strokes';
export const DOC_META_KEY = 'meta';
export const fileTextKey = (fileId: string): string => `file:${fileId}`;

export const DEFAULT_FILE: FileMeta = {
  id: 'main',
  name: 'main.py',
  createdAt: 0, // deterministic: a timestamp here would differ per seeder
};

export const DEFAULT_FILE_CONTENT = `# Two people, one file. Try typing while someone else does.

def fizzbuzz(n: int) -> str:
    if n % 15 == 0:
        return "FizzBuzz"
    if n % 3 == 0:
        return "Fizz"
    if n % 5 == 0:
        return "Buzz"
    return str(n)


for i in range(1, 16):
    print(fizzbuzz(i))
`;
