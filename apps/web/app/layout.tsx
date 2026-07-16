import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'CRDT Sandbox',
  description: 'A real-time collaborative code review sandbox.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="h-full bg-neutral-950 text-neutral-100 antialiased">{children}</body>
    </html>
  );
}
