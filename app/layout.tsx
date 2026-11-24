import type { Metadata } from 'next';
import './globals.css';
import './shell.css';
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
import ThemeRegistry from '@/client/theme';
import { Onest } from 'next/font/google';

// Served from this site (no request to Google from visitors' browsers).
const ui = Onest({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-ui',
});

export const metadata: Metadata = {
  title: 'TicketForge',
  description:
    'Turn requirement documents into epics, issues, acceptance criteria and test cases with Claude.',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%23161616'/><path d='M8 9h16v4h-6v11h-4V13H8z' fill='white'/></svg>",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={ui.variable} suppressHydrationWarning>
      <body>
        {/* Applies the saved theme (light by default) before the page paints, so there is no flash. */}
        <InitColorSchemeScript
          attribute="data-theme"
          defaultMode="light"
          modeStorageKey="tf-theme"
        />
        <ThemeRegistry>{children}</ThemeRegistry>
      </body>
    </html>
  );
}
