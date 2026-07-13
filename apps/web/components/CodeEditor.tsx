'use client';

import Editor from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useEffect, useState } from 'react';
import { MonacoBinding } from 'y-monaco';
import { DEFAULT_FILE, LANGUAGES, getFileText } from '@sandbox/shared';
import { setupMonaco } from '@/lib/monaco/setup';
import { useRoomContext } from '@/lib/yjs/RoomContext';

setupMonaco();

export function CodeEditor() {
  const { doc, awareness } = useRoomContext();
  const [instance, setInstance] = useState<editor.IStandaloneCodeEditor | null>(null);

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
