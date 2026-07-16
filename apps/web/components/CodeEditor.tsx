'use client';

import Editor, { useMonaco } from '@monaco-editor/react';
import { DEFAULT_FILE, LANGUAGES, getFileText } from '@sandbox/shared';
import type { editor } from 'monaco-editor';
import { useEffect, useRef, useState } from 'react';
import { MonacoBinding } from 'y-monaco';
import { useExecContext } from '@/lib/exec/ExecContext';
import { setupMonaco } from '@/lib/monaco/setup';
import { useRoomContext } from '@/lib/yjs/RoomContext';
import { useFile } from '@/lib/yjs/useFile';

setupMonaco();

export function CodeEditor() {
  const { doc, awareness } = useRoomContext();
  const { runActiveFile } = useExecContext();
  const monaco = useMonaco();
  const file = useFile(DEFAULT_FILE.id);
  const [instance, setInstance] = useState<editor.IStandaloneCodeEditor | null>(null);

  // addCommand's handler is registered once and would otherwise close over a stale runActiveFile.
  const run = useRef(runActiveFile);
  run.current = runActiveFile;

  useEffect(() => {
    const model = instance?.getModel();
    if (!instance || !model) return;

    // MonacoBinding seeds the model from the Y.Text. Never pass `value`/`defaultValue` to
    // <Editor>: the binding would push that content back into the CRDT and duplicate it.
    const binding = new MonacoBinding(
      getFileText(doc, DEFAULT_FILE.id),
      model,
      new Set([instance]),
      awareness,
    );
    return () => binding.destroy();
  }, [instance, doc, awareness]);

  // Monaco swallows keydown, so a document-level listener never fires while the editor has focus.
  useEffect(() => {
    if (!instance || !monaco) return;

    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => run.current());
  }, [instance, monaco]);

  // The language picker is a Y.Doc write, so it arrives here for everyone, not just the picker.
  useEffect(() => {
    const model = instance?.getModel();
    if (!monaco || !model || !file) return;

    monaco.editor.setModelLanguage(model, LANGUAGES[file.language].monaco);
  }, [instance, monaco, file]);

  return (
    <Editor
      height="100%"
      theme="vs-dark"
      path={DEFAULT_FILE.name}
      defaultLanguage={LANGUAGES[DEFAULT_FILE.language].monaco}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        automaticLayout: true,
        scrollBeyondLastLine: false,
      }}
      onMount={setInstance}
      loading={
        <div className="grid h-full place-items-center text-neutral-500">Loading editor…</div>
      }
    />
  );
}
