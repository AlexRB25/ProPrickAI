import { NextResponse } from "next/server";
import { tallies, type Target } from "@/lib/apuestas";
import { authUser, db, dbConfigured, fail } from "@/lib/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Vota por una apuesta o parlay: { target_type, target_id, valor: 1 | -1 | 0 (quitar) }. Solo antes de que empiece. */
export async function POST(req: Request) {
  if (!dbConfigured()) return fail("Falta configurar Supabase.", 500);
  const user = await authUser(req);
  if (!user) return fail("Entra con tu cuenta para votar.", 401);
  if (user.blocked) return fail("Tu cuenta está bloqueada.", 403);

  const b = await req.json().catch(() => null);
  const type: Target = b?.target_type === "parlay" ? "parlay" : "pick";
  const id = String(b?.target_id ?? "");
  const valor = Number(b?.valor);
  if (!UUID.test(id) || ![1, -1, 0].includes(valor)) return fail("Voto inválido");

  // Solo se vota antes de que empiece el partido (o el primero del parlay).
  const { data: t } =
    type === "pick"
      ? await db().from("picks").select("game_date").eq("id", id).maybeSingle()
      : await db().from("parlays").select("game_date:first_game").eq("id", id).maybeSingle();
  if (!t) return fail("No existe esa apuesta", 404);
  if (Date.parse(t.game_date) <= Date.now()) return fail("Las votaciones cierran cuando empieza el partido.");

  const { error } =
    valor === 0
      ? await db().from("votos").delete().eq("user_id", user.id).eq("target_type", type).eq("target_id", id)
      : await db().from("votos").upsert({ user_id: user.id, target_type: type, target_id: id, valor, created_at: new Date().toISOString() });
  if (error) return fail(error.message, 500);
  return NextResponse.json({ votos: (await tallies(type, [id])).get(id), miVoto: valor });
}
