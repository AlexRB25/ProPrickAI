import type { Metadata } from "next";
import "./globals.css";
import { BugButton } from "./BugButton";

export const metadata: Metadata = {
  title: "ProPicksAI",
  description: "Pronósticos con IA para más de 30 deportes: análisis, parlays, ganadores y ventana flotante que analiza tu pantalla.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        {children}
        <BugButton />
      </body>
    </html>
  );
}
