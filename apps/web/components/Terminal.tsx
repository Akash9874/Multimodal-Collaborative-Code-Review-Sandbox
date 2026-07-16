'use client';

import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import { useExecContext } from '@/lib/exec/ExecContext';
import { renderRuns } from '@/lib/exec/render';

export function Terminal() {
  const { runs, notice } = useExecContext();
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | null>(null);

  useEffect(() => {
    if (!host.current) return;

    const xterm = new XTerm({
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      cursorBlink: false,
      disableStdin: true, // a shared output console, not a pty
      theme: { background: '#0a0a0a', foreground: '#e5e5e5' },
    });

    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(host.current);
    fit.fit();
    term.current = xterm;

    const onResize = () => fit.fit();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      xterm.dispose();
      term.current = null;
    };
  }, []);

  // The whole scrollback is re-rendered from state on every change. That is affordable, and it is
  // what makes reconnect correct for free: Piston is request/response, so one run produces about
  // three messages, not a stream of them.
  useEffect(() => {
    const xterm = term.current;
    if (!xterm) return;

    xterm.reset();
    xterm.write(renderRuns(runs, notice));
  }, [runs, notice]);

  return <div data-testid="terminal" ref={host} className="h-full w-full overflow-hidden" />;
}
