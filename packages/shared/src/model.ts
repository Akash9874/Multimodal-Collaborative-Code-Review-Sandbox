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

export type FileMeta = {
  id: string;
  name: string;
  language: LanguageId;
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
  language: 'python',
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
