import type { ReactNode } from 'react';
import { siteMetadata } from './lib/seo';
import './globals.css';

export function generateMetadata() { return siteMetadata(); }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: '#0a0f1e',
          color: '#e6edf7',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        {children}
      </body>
    </html>
  );
}
