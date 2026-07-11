import type { Metadata } from "next";
import { Bricolage_Grotesque, Montserrat } from "next/font/google";
import NextTopLoader from "nextjs-toploader";
import "./globals.css";
// Landing-page styles are fully scoped under `.landing-page`, so loading them
// globally here (rather than importing inside the marketing client component)
// is safe and avoids the per-route CSS chunk that left /login unstyled on soft
// navigation from the home page.
import "./landing.css";
import { PostHogProvider } from "@/components/analytics/posthog-provider";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

// KO OS brand typography (docs/KO_Design_System.docx §2.2):
// "Brand font: Bricolage Bold pair with Mont Regular."
//   • Bricolage Grotesque → headings (700 bold, 600 semibold for H3/labels)
//   • Montserrat          → body (400 regular, 500 medium, 600 labels/buttons)
// Weight discipline: never more than two weights in one view.
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "KO OS — Your Brand Brain, powered by KO",
  description:
    "AI-powered content strategies and calendars. Human designers bring them to life.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${bricolage.variable} ${montserrat.variable} h-full antialiased`}
    >
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
        />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {/* Top progress bar during client-side route transitions. */}
        <NextTopLoader
          color="#138BC8"
          height={3}
          showSpinner={false}
          shadow="0 0 10px #138BC8, 0 0 5px #138BC8"
        />
        <Providers>
          <PostHogProvider />
          <TooltipProvider delay={200}>{children}</TooltipProvider>
          <Toaster position="bottom-right" richColors closeButton />
        </Providers>
      </body>
    </html>
  );
}
