import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, Space_Mono } from 'next/font/google';
import './globals.css';

const display = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-display',
});

const mono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Kakushō Protocol — 確証',
  description: 'Zero-knowledge KYC for the Stellar ecosystem. Identity proven, never revealed.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="kz-display">{children}</body>
    </html>
  );
}