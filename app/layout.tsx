import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import '@openmaic/renderer/fonts.css';
import 'animate.css';
import 'katex/dist/katex.min.css';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { I18nProvider } from '@/lib/hooks/use-i18n';
import { Toaster } from '@/components/ui/sonner';
import { ServerProvidersInit } from '@/components/server-providers-init';
import { StorageHealthNotice } from '@/components/storage-health-notice';
import { ProSwapWatcher } from '@/components/workbench/ProSwapWatcher';
import { OpenMaicCapabilitiesProvider } from '@/lib/reachacademy/bridge/client-capabilities';
import { getServerOpenMaicCapabilities } from '@/lib/reachacademy/bridge/server-capabilities';
import { GrantRequiredGate } from '@/components/reachacademy/GrantRequiredGate';
import { GrantRenewalMount } from '@/components/reachacademy/GrantRenewalMount';

// Capabilities are derived from the request's HttpOnly OpenMAIC session
// cookie. Prevent Next from baking an unauthenticated build-time snapshot into
// the root layout.
export const dynamic = 'force-dynamic';

// The UI font is loaded from @fontsource's stylesheet rather than next/font,
// because only the stylesheet carries the per-subset `unicode-range`
// declarations. Pointing next/font at `inter-latin-wght-normal.woff2` loaded
// exactly one subset, so every character outside Latin — Cyrillic for ru-RU,
// tone-marked letters for vi-VN — fell back to an arbitrary OS font and
// rendered in a different typeface mid-word.
//
// Declaring the other subset files as sibling faces of the same family does not
// fix it either: faces with identical descriptors and no `unicode-range` do not
// fall through per glyph, so the browser simply picks one.
//
// `--font-sans` moves to globals.css since the family no longer comes from
// next/font's generated class.
import '@fontsource-variable/inter';

export const metadata: Metadata = {
  title: 'OpenMAIC',
  description:
    'The open-source AI interactive classroom. Upload a PDF to instantly generate an immersive, multi-agent learning experience.',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const bridgeCapabilities = await getServerOpenMaicCapabilities();
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider>
          <I18nProvider>
            <OpenMaicCapabilitiesProvider value={bridgeCapabilities}>
              <GrantRenewalMount />
              <ServerProvidersInit />
              <ProSwapWatcher />
              <GrantRequiredGate>{children}</GrantRequiredGate>
              <Toaster position="top-center" />
            </OpenMaicCapabilitiesProvider>
            {/* After the Toaster: this one raises a toast on mount when
                persistence is already broken, and a toast raised before its
                host exists has nowhere to go. */}
            <StorageHealthNotice />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
