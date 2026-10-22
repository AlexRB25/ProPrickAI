import { NextResponse } from "next/server";
import { nombrePublico } from "@/lib/apuestas";
import { authUser, db, dbConfigured, fail } from "@/lib/server";

const ALIAS = /^[\p{L}\p{N} ._-]{3,24}$/u;

/** Nombre público para los comentarios: GET lo lee, POST { alias } lo cambia. */
export async function GET(req: Request) {
  if (!dbConfigured()) return fail("Falta configurar Supabase.", 500);
  const user = await authUser(req);
  if (!user) return NextResponse.json({ nombre: null });
  const { data } = await db().from("profiles").select("alias").eq("id", user.id).maybeSingle();
  return NextResponse.json({ nombre: nombrePublico(user.email, data?.alias ?? null), alias: data?.alias ?? null });
}

export async function POST(req: Request) {
  if (!dbConfigured()) return fail("Falta configurar Supabase.", 500);
  const user = await authUser(req);
  if (!user) return fail("Entra con tu cuenta.", 401);
  const alias = String((await req.json().catch(() => null))?.alias ?? "").trim();
  if (!ALIAS.test(alias)) return fail("Usa de 3 a 24 letras, números, espacios, punto o guion.");
  const { error } = await db().from("profiles").update({ alias }).eq("id", user.id);
  return error ? fail(error.message, 500) : NextResponse.json({ nombre: alias });
}
