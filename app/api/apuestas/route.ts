import { NextResponse } from "next/server";
import { commentCounts, myVotes, parlayEstado, pickStatuses, tallies } from "@/lib/apuestas";
import { authUser, db, dbConfigured, fail } from "@/lib/server";

export const dynamic = "force-dynamic";

const PAGE = 24;

/**
 * Apuestas publicadas. ?tipo=individual|parlay&sport=&orden=recientes|votadas|proximas&page=
 * Individuales = picks de análisis de un partido; parlays = los que se armaron.
 */
export async function GET(req: Request) {
  if (!dbConfigured()) return fail("Falta configurar Supabase.", 500);
  const q = new URL(req.url).searchParams;
  const tipo = q.get("tipo") === "parlay" ? "parlay" : "individual";
  const sport = q.get("sport") ?? "";
  const orden = q.get("orden") ?? "recientes";
  const page = Math.max(0, Number(q.get("page")) || 0);
  const user = await authUser(req);
  const now = new Date().toISOString();

  // "Más votadas" se ordena en memoria sobre las últimas 500.
  const porVotos = orden === "votadas";
  const from = porVotos ? 0 : page * PAGE;
  const to = porVotos ? 499 : page * PAGE + PAGE - 1;

  if (tipo === "individual") {
    let query = db()
      .from("picks")
      .select("id, sport, league_name, title, game_date, mercado, seleccion, probabilidad, cuota, cuota_estimada, status, resultado, created_at")
      .eq("origen", "partido");
    if (sport) query = query.eq("sport", sport);
    query =
      orden === "proximas"
        ? query.gt("game_date", now).order("game_date", { ascending: true })
        : query.order("created_at", { ascending: false });
    const { data, error } = await query.range(from, to);
    if (error) return fail(error.message, 500);
    const rows = data ?? [];
    const ids = rows.map((r) => r.id);
    const [t, mine, cc] = await Promise.all([tallies("pick", ids), myVotes(user?.id ?? null, "pick", ids), commentCounts("pick", ids)]);
    let items = rows.map((r) => ({ ...r, votos: t.get(r.id)!, miVoto: mine.get(r.id) ?? 0, comentarios: cc.get(r.id) ?? 0, abierta: Date.parse(r.game_date) > Date.now() }));
    if (porVotos) items = items.sort((a, b) => b.votos.si + b.votos.no - (a.votos.si + a.votos.no)).slice(page * PAGE, page * PAGE + PAGE);
    return NextResponse.json({ tipo, items, hayMas: items.length === PAGE });
  }

  let query = db().from("parlays").select("id, tipo, piernas, pick_ids, apuestas, partidos, probabilidad, cuota_americana, sports, first_game, created_at");
  if (sport) query = query.contains("sports", [sport]);
  query =
    orden === "proximas"
      ? query.gt("first_game", now).order("first_game", { ascending: true })
      : query.order("created_at", { ascending: false });
  const { data, error } = await query.range(from, to);
  if (error) return fail(error.message, 500);
  const rows = data ?? [];
  const ids = rows.map((r) => r.id);
  const [t, mine, cc, st] = await Promise.all([
    tallies("parlay", ids),
    myVotes(user?.id ?? null, "parlay", ids),
    commentCounts("parlay", ids),
    pickStatuses([...new Set(rows.flatMap((r) => r.pick_ids as string[]))]),
  ]);
  let items = rows.map((r) => ({
    ...r,
    estado: parlayEstado((r.pick_ids as string[]).map((id) => st.get(id) ?? "pendiente")),
    votos: t.get(r.id)!,
    miVoto: mine.get(r.id) ?? 0,
    comentarios: cc.get(r.id) ?? 0,
    abierta: Date.parse(r.first_game) > Date.now(),
  }));
  if (porVotos) items = items.sort((a, b) => b.votos.si + b.votos.no - (a.votos.si + a.votos.no)).slice(page * PAGE, page * PAGE + PAGE);
  return NextResponse.json({ tipo, items, hayMas: items.length === PAGE });
}
