import { NextResponse } from "next/server";
import { nombrePublico, type Target } from "@/lib/apuestas";
import { authUser, db, dbConfigured, fail } from "@/lib/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POR_HORA = 20;

/** Comenta una apuesta o parlay: { target_type, target_id, texto }. */
export async function POST(req: Request) {
  if (!dbConfigured()) return fail("Falta configurar Supabase.", 500);
  const user = await authUser(req);
  if (!user) return fail("Entra con tu cuenta para comentar.", 401);
  if (user.blocked) return fail("Tu cuenta está bloqueada.", 403);

  const b = await req.json().catch(() => null);
  const type: Target = b?.target_type === "parlay" ? "parlay" : "pick";
  const id = String(b?.target_id ?? "");
  const texto = String(b?.texto ?? "").trim();
  if (!UUID.test(id)) return fail("Apuesta inválida");
  if (!texto || texto.length > 1000) return fail("El comentario debe tener entre 1 y 1000 caracteres.");

  const exists = await db().from(type === "pick" ? "picks" : "parlays").select("id").eq("id", id).maybeSingle();
  if (!exists.data) return fail("No existe esa apuesta", 404);

  // Freno contra spam.
  const { count } = await db()
    .from("comentarios")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", new Date(Date.now() - 3600000).toISOString());
  if ((count ?? 0) >= POR_HORA) return fail("Llegaste al límite de comentarios por hora. Intenta más tarde.", 429);

  const { data, error } = await db()
    .from("comentarios")
    .insert({ user_id: user.id, target_type: type, target_id: id, texto })
    .select("id, texto, created_at")
    .single();
  if (error) return fail(error.message, 500);
  const { data: p } = await db().from("profiles").select("alias").eq("id", user.id).maybeSingle();
  return NextResponse.json({ ...data, autor: nombrePublico(user.email, p?.alias ?? null), oculto: false, mio: true });
}
