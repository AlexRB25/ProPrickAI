import type { Metadata } from "next";
import "./globals.css";
import { BugButton } from "./BugButton";

export const metadata: Metadata = {
  title: "Pronósticos IA",
  description: "Pronósticos con IA para NFL, fútbol y básquetbol, con ventana flotante que analiza tu pantalla.",
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
