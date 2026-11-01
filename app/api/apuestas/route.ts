import { NextResponse } from "next/server";
import { commentCounts, myVotes, parlayEstado, pickStatuses, tallies } from "@/lib/apuestas";
import { hasAccess } from "@/lib/billing";
import type { Game } from "@/lib/espn";
import { liveStatus, terminado } from "@/lib/live";
import { authUser, db, dbConfigured, fail } from "@/lib/server";

export const dynamic = "force-dynamic";

const PAGE = 24;
const DAY = 86400000;

/**
 * Apuestas publicadas que todavía no terminan (por jugarse o en vivo, con marcador).
 * Solo para suscriptores. ?tipo=individual|parlay&sport=&orden=recientes|votadas|proximas&page=
 */
export async function GET(req: Request) {
  if (!dbConfigured()) return fail("Falta configurar Supabase.", 500);
  const user = await authUser(req);
  if (!user) return NextResponse.json({ error: "Entra con tu cuenta para ver las apuestas.", gate: "login" }, { status: 401 });
  if (!(await hasAccess(user))) return NextResponse.json({ error: "Esta sección es para suscriptores.", gate: "suscripcion" }, { status: 402 });

  const q = new URL(req.url).searchParams;
  const tipo = q.get("tipo") === "parlay" ? "parlay" : "individual";
  const sport = q.get("sport") ?? "";
  const orden = q.get("orden") ?? "recientes";
  const page = Math.max(0, Number(q.get("page")) || 0);
  // Lo que empezó hace más de 5 días ya terminó (los torneos más largos duran 4).
  const desde = new Date(Date.now() - 5 * DAY).toISOString();

  const ordenar = <T extends { created_at: string; votos: { si: number; no: number } }>(list: T[], fecha: (x: T) => string) => {
    if (orden === "votadas") return list.sort((a, b) => b.votos.si + b.votos.no - (a.votos.si + a.votos.no));
    if (orden === "proximas") return list.sort((a, b) => fecha(a).localeCompare(fecha(b)));
    return list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  };

  if (tipo === "individual") {
    let query = db()
      .from("picks")
      .select("id, game, sport, league_name, title, game_date, mercado, seleccion, probabilidad, cuota, cuota_estimada, status, created_at")
      .eq("origen", "partido")
      .eq("status", "pendiente")
      .gte("game_date", desde);
    if (sport) query = query.eq("sport", sport);
    const { data, error } = await query.order("game_date", { ascending: true }).limit(600);
    if (error) return fail(error.message, 500);

    const rows = data ?? [];
    const started = rows.filter((r) => Date.parse(r.game_date) <= Date.now()).map((r) => r.game as Game);
    const live = await liveStatus(started);
    const vivos = rows.filter((r) => Date.parse(r.game_date) > Date.now() || !terminado(r.game as Game, live.get((r.game as Game).id)));

    const ids = vivos.map((r) => r.id);
    const [t, mine, cc] = await Promise.all([tallies("pick", ids), myVotes(user.id, "pick", ids), commentCounts("pick", ids)]);
    const items = vivos.map(({ game, ...r }) => ({
      ...r,
      votos: t.get(r.id)!,
      miVoto: mine.get(r.id) ?? 0,
      comentarios: cc.get(r.id) ?? 0,
      abierta: Date.parse(r.game_date) > Date.now(),
      live: live.get((game as Game).id) ?? null,
    }));
    const pagina = ordenar(items, (x) => x.game_date).slice(page * PAGE, page * PAGE + PAGE);
    return NextResponse.json({ tipo, items: pagina, hayMas: items.length > (page + 1) * PAGE });
  }

  let query = db()
    .from("parlays")
    .select("id, tipo, piernas, pick_ids, apuestas, partidos, probabilidad, cuota_americana, sports, first_game, created_at")
    .gte("first_game", desde);
  if (sport) query = query.contains("sports", [sport]);
  const { data, error } = await query.order("first_game", { ascending: true }).limit(400);
  if (error) return fail(error.message, 500);
  const rows = data ?? [];

  // Estado de cada pierna (calificada o no) y marcador de las que ya empezaron.
  const st = await pickStatuses([...new Set(rows.flatMap((r) => r.pick_ids as string[]))]);
  const legGames = new Map<string, Game>();
  const { data: legPicks } = await db().from("picks").select("id, game").in("id", [...st.keys()]);
  for (const p of legPicks ?? []) legGames.set(p.id, p.game as Game);
  const live = await liveStatus([...legGames.values()].filter((g) => Date.parse(g.date) <= Date.now()));

  const vivos = rows
    .map((r) => {
      const piernas = (r.piernas as { pick_id: string; game_date: string }[]).map((l) => {
        const g = legGames.get(l.pick_id);
        const lv = g ? (live.get(g.id) ?? null) : null;
        const fin = g ? Date.parse(g.date) <= Date.now() && terminado(g, lv ?? undefined) : false;
        return { ...l, estado: st.get(l.pick_id) ?? "pendiente", live: lv, terminado: fin };
      });
      return { ...r, piernas, estado: parlayEstado(piernas.map((l) => l.estado)) };
    })
    // Fuera: los ya decididos (una pierna perdida lo tumba) y los que ya jugaron todos sus partidos.
    .filter((r) => r.estado === "pendiente" && !r.piernas.every((l) => l.terminado));

  const ids = vivos.map((r) => r.id);
  const [t, mine, cc] = await Promise.all([tallies("parlay", ids), myVotes(user.id, "parlay", ids), commentCounts("parlay", ids)]);
  const items = vivos.map((r) => ({
    ...r,
    votos: t.get(r.id)!,
    miVoto: mine.get(r.id) ?? 0,
    comentarios: cc.get(r.id) ?? 0,
    abierta: Date.parse(r.first_game) > Date.now(),
    enVivo: r.piernas.filter((l) => l.live?.state === "in").length,
  }));
  const pagina = ordenar(items, (x) => x.first_game).slice(page * PAGE, page * PAGE + PAGE);
  return NextResponse.json({ tipo, items: pagina, hayMas: items.length > (page + 1) * PAGE });
}
