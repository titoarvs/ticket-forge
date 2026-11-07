import type { Metadata } from 'next';
import './globals.css';
import ThemeRegistry from '@/client/theme';

export const metadata: Metadata = {
  title: 'TicketForge',
  description: 'Turn requirement documents into epics, issues, acceptance criteria and test cases with Claude.',
  icons: { icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%230c66e4'/><path d='M8 9h16v4h-6v11h-4V13H8z' fill='white'/></svg>" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><ThemeRegistry>{children}</ThemeRegistry></body>
    </html>
  );
}
