'use client';

import Editor, { useMonaco } from '@monaco-editor/react';
import { LANGUAGES, getFileText, languageForName } from '@sandbox/shared';
import type { editor } from 'monaco-editor';
import { useEffect, useRef, useState } from 'react';
import { MonacoBinding } from 'y-monaco';
import { CanvasOverlay } from './CanvasOverlay';
import { useExecContext } from '@/lib/exec/ExecContext';
import { useActiveFile } from '@/lib/files/ActiveFileContext';
import { setupMonaco } from '@/lib/monaco/setup';
import { useRoomContext } from '@/lib/yjs/RoomContext';
import { useFile } from '@/lib/yjs/useFile';

setupMonaco();

export function CodeEditor() {
  const { doc, awareness } = useRoomContext();
  const { runActiveFile } = useExecContext();
  const { activeFileId } = useActiveFile();
  const monaco = useMonaco();
  const file = useFile(activeFileId);
  const [instance, setInstance] = useState<editor.IStandaloneCodeEditor | null>(null);

  // addCommand's handler is registered once and would otherwise close over a stale runActiveFile.
  const run = useRef(runActiveFile);
  run.current = runActiveFile;

  // Exactly ONE binding is alive at a time — to the active file. y-monaco writes its selection
  // into awareness, so a binding per open file would mean several writers racing over one field,
  // and remote cursors bleeding into files they are not in. Destroying on switch makes that
  // impossible by construction rather than by a filter someone can forget.
  useEffect(() => {
    const model = instance?.getModel();
    if (!instance || !model) return;

    // MonacoBinding seeds the model from the Y.Text. Never pass `value`/`defaultValue` to
    // <Editor>: the binding would push that content back into the CRDT and duplicate it.
    const binding = new MonacoBinding(
      getFileText(doc, activeFileId),
      model,
      new Set([instance]),
      awareness,
    );
    return () => binding.destroy();
  }, [instance, doc, awareness, activeFileId]);

  // Tell the room which file you are looking at. CanvasOverlay filters remote pens on this.
  useEffect(() => {
    awareness.setLocalStateField('activeFileId', activeFileId);
  }, [awareness, activeFileId]);

  // Monaco swallows keydown, so a document-level listener never fires while the editor has focus.
  useEffect(() => {
    if (!instance || !monaco) return;

    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => run.current());
  }, [instance, monaco]);

  // A rename is a Y.Doc write, so it arrives here for everyone, not just the renamer.
  useEffect(() => {
    const model = instance?.getModel();
    if (!monaco || !model || !file) return;

    const language = languageForName(file.name);
    monaco.editor.setModelLanguage(model, language ? LANGUAGES[language].monaco : 'plaintext');
  }, [instance, monaco, file]);

  return (
    <div className="relative h-full">
      <Editor
        height="100%"
        theme="vs-dark"
        // The id, not the name: Monaco keys its models by path, and duplicate filenames are
        // tolerated by design — two files called utils.py must not share one model.
        path={activeFileId}
        defaultLanguage="python"
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
      {instance && <CanvasOverlay instance={instance} />}
    </div>
  );
}
