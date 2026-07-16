import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

let configured = false;

export const setupMonaco = (): void => {
  if (configured || typeof window === 'undefined') return;
  configured = true;

  // Monaco's language services run in workers; it throws on boot without this.
  window.MonacoEnvironment = {
    getWorker(_id: string, label: string) {
      if (label === 'typescript' || label === 'javascript') {
        return new Worker(
          new URL('monaco-editor/esm/vs/language/typescript/ts.worker.js', import.meta.url),
        );
      }
      return new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url));
    },
  };

  // The npm build, not the CDN: y-monaco imports `monaco-editor` directly, and two copies of
  // Monaco on one page render no remote cursors at all.
  loader.config({ monaco });
};
