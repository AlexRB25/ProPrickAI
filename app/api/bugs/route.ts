import { NextResponse } from "next/server";
import { authUser, db, dbConfigured, fail } from "@/lib/server";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Reporte de una falla. Con sesión se liga al usuario; sin sesión pide un correo de contacto. */
export async function POST(req: Request) {
  if (!dbConfigured()) return fail("Falta configurar Supabase.", 500);
  const body = await req.json().catch(() => null);
  if (body?.sitio) return NextResponse.json({ ok: true }); // campo trampa para bots

  const mensaje = String(body?.mensaje ?? "").trim();
  if (mensaje.length < 5) return fail("Cuéntanos qué pasó (al menos unas palabras).");
  const user = await authUser(req);
  const email = user?.email ?? String(body?.email ?? "").trim();
  if (!user && !EMAIL.test(email)) return fail("Escribe un correo para poder contestarte.");

  const { error } = await db()
    .from("bug_reports")
    .insert({
      user_id: user?.id ?? null,
      email,
      mensaje: mensaje.slice(0, 4000),
      pagina: String(body?.pagina ?? "").slice(0, 300),
      user_agent: (req.headers.get("user-agent") ?? "").slice(0, 300),
    });
  return error ? fail("No se pudo enviar el reporte. Intenta de nuevo.", 500) : NextResponse.json({ ok: true });
}
