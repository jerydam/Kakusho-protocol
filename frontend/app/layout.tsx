import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';

const display = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-display',
});

const spaceMono = localFont({
  src: [
    { path: '../public/fonts/SpaceMono-Regular.woff2', weight: '400' },
    { path: '../public/fonts/SpaceMono-Bold.woff2', weight: '700' },
  ],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Kakushō Protocol — 確証',
  description: 'Zero-knowledge KYC for the Stellar ecosystem. Identity proven, never revealed.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${spaceMono.variable}`}>
      <body className="kz-display">{children}</body>
    </html>
  );
}