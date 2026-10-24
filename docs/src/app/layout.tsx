import type { Metadata } from 'next';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';
import './global.css';

export const metadata: Metadata = {
  title: { default: 'Quell documentation', template: '%s | Quell' },
  description: 'API, operations, and data-handling guides for Quell live-chat moderation.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider search={{ options: { type: 'static', api: `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/api/search.json` } }}>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
