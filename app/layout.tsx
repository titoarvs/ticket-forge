import type { Metadata } from 'next';
import './globals.css';
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
import ThemeRegistry from '@/client/theme';

export const metadata: Metadata = {
  title: 'TicketForge',
  description: 'Turn requirement documents into epics, issues, acceptance criteria and test cases with Claude.',
  icons: { icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%230c66e4'/><path d='M8 9h16v4h-6v11h-4V13H8z' fill='white'/></svg>" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" />
      </head>
      <body>
        {/* Applies the saved theme (dark by default) before the page paints, so there is no flash. */}
        <InitColorSchemeScript attribute="data-theme" defaultMode="dark" modeStorageKey="tf-theme" />
        <ThemeRegistry>{children}</ThemeRegistry></body>
    </html>
  );
}
