import { NextResponse } from "next/server";
import { myVotes, nombrePublico, parlayEstado, pickStatuses, tallies, type Target } from "@/lib/apuestas";
import { norm } from "@/lib/cache";
import { hasAccess } from "@/lib/billing";
import type { Game } from "@/lib/espn";
import { liveStatus } from "@/lib/live";
import { authUser, db, dbConfigured, fail } from "@/lib/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Una apuesta publicada con sus votos y comentarios. ?tipo=pick|parlay&id= */
export async function GET(req: Request) {
  if (!dbConfigured()) return fail("Falta configurar Supabase.", 500);
  const q = new URL(req.url).searchParams;
  const tipo: Target = q.get("tipo") === "parlay" ? "parlay" : "pick";
  const id = q.get("id") ?? "";
  if (!UUID.test(id)) return fail("Apuesta inválida");
  const user = await authUser(req);
  if (!user) return NextResponse.json({ error: "Entra con tu cuenta para ver las apuestas.", gate: "login" }, { status: 401 });
  if (!(await hasAccess(user))) return NextResponse.json({ error: "Esta sección es para suscriptores.", gate: "suscripcion" }, { status: 402 });

  const [comentarios, votos, mio] = await Promise.all([
    db().from("comentarios").select("id, user_id, texto, oculto, created_at").eq("target_type", tipo).eq("target_id", id).order("created_at", { ascending: false }).limit(200),
    tallies(tipo, [id]),
    myVotes(user?.id ?? null, tipo, [id]),
  ]);
  const autores = [...new Set((comentarios.data ?? []).map((c) => c.user_id))];
  const perfiles = autores.length ? (await db().from("profiles").select("id, email, alias").in("id", autores)).data ?? [] : [];
  const nombre = new Map(perfiles.map((p) => [p.id, nombrePublico(p.email, p.alias)]));
  const lista = (comentarios.data ?? [])
    .filter((c) => !c.oculto || user?.isAdmin)
    .map((c) => ({ id: c.id, autor: nombre.get(c.user_id) ?? "anónimo", texto: c.texto, oculto: c.oculto, mio: c.user_id === user?.id, created_at: c.created_at }));
  const base = { comentarios: lista, votos: votos.get(id)!, miVoto: mio.get(id) ?? 0, isAdmin: Boolean(user?.isAdmin) };

  if (tipo === "pick") {
    const { data: p } = await db()
      .from("picks")
      .select("id, analysis_id, game, sport, league_name, title, game_date, mercado, seleccion, selecciones, probabilidad, cuota, cuota_estimada, status, resultado, origen")
      .eq("id", id)
      .maybeSingle();
    if (!p) return fail("No existe esa apuesta", 404);
    // Las razones vienen del análisis que la generó.
    let razones: string[] = [];
    let resumen = "";
    if (p.analysis_id) {
      const { data: a } = await db().from("analyses").select("result").eq("id", p.analysis_id).maybeSingle();
      const r = a?.result as { resumen?: string; picks?: { seleccion: string; razones?: string[] }[]; juego?: { opciones?: { seleccion: string; razon?: string }[] } } | undefined;
      const match = r?.picks?.find((x) => norm(x.seleccion) === norm(p.seleccion));
      razones = match?.razones ?? [];
      resumen = r?.resumen ?? "";
      if (!razones.length) {
        const opt = r?.juego?.opciones?.find((x) => norm(x.seleccion) === norm(p.seleccion));
        if (opt?.razon) razones = [opt.razon];
      }
    }
    const g = p.game as Game;
    const live = Date.parse(p.game_date) <= Date.now() ? ((await liveStatus([g])).get(g.id) ?? null) : null;
    return NextResponse.json({ ...base, tipo, apuesta: { ...p, game: undefined, analysis_id: undefined, razones, resumen, live, abierta: Date.parse(p.game_date) > Date.now() } });
  }

  const { data: pl } = await db().from("parlays").select("*").eq("id", id).maybeSingle();
  if (!pl) return fail("No existe ese parlay", 404);
  const pickIds = pl.pick_ids as string[];
  const [st, legVotes, legMine, legPicks] = await Promise.all([
    pickStatuses(pickIds),
    tallies("pick", pickIds),
    myVotes(user?.id ?? null, "pick", pickIds),
    db().from("picks").select("id, game").in("id", pickIds),
  ]);
  const gameOf = new Map((legPicks.data ?? []).map((p) => [p.id, p.game as Game]));
  const live = await liveStatus([...gameOf.values()].filter((g) => Date.parse(g.date) <= Date.now()));
  const piernas = (pl.piernas as { pick_id: string; game_date: string }[]).map((l) => ({
    ...l,
    estado: st.get(l.pick_id) ?? "pendiente",
    votos: legVotes.get(l.pick_id)!,
    miVoto: legMine.get(l.pick_id) ?? 0,
    abierta: Date.parse(l.game_date) > Date.now(),
    live: gameOf.get(l.pick_id) ? (live.get(gameOf.get(l.pick_id)!.id) ?? null) : null,
  }));
  return NextResponse.json({
    ...base,
    tipo,
    apuesta: { ...pl, created_by: undefined, piernas, estado: parlayEstado(piernas.map((l) => l.estado)), abierta: Date.parse(pl.first_game) > Date.now() },
  });
}
