import { NextResponse } from "next/server";
import { analyzeParlayGames } from "@/lib/ai";
import { charge, getTarifas, hasAccess, logConsulta, refund, SIN_SUSCRIPCION, sinCreditos } from "@/lib/billing";
import { getCached, parlayKey, putAnalysis, recordPicks, resolveGame } from "@/lib/cache";
import type { Game } from "@/lib/espn";
import { describeMarkets, type MarketSelection } from "@/lib/markets";
import { comboMaxSize, type GameOptions } from "@/lib/parlay";
import { publishParlays } from "@/lib/publicar";
import { aiErrorMessage, fail, requireUser } from "@/lib/server";

// Tope del plan Hobby de Vercel; con muchos partidos la IA puede tardar varios minutos.
export const maxDuration = 300;

const MAX_PARLAY_GAMES = 20;

// Lo que se guarda en caché por partido.
interface Entry {
  juego: GameOptions;
  advertencias: string[];
  fuentes: { title: string; url: string }[];
}

export async function POST(req: Request) {
  const user = await requireUser(req);
  if (user instanceof NextResponse) return user;
  if (!(await hasAccess(user))) return fail(SIN_SUSCRIPCION, 402);

  let raw: Game[];
  let mercados: MarketSelection | undefined;
  let sameGame = true;
  let maxLegs = 4;
  let minLegs = 2;
  let refresh = false;
  try {
    const body = await req.json();
    raw = body.games;
    mercados = body.mercados;
    sameGame = body.sameGame !== false;
    maxLegs = Math.min(20, Math.max(2, Number(body.maxLegs) || 4));
    minLegs = Math.min(maxLegs, Math.max(2, Number(body.minLegs) || 2));
    refresh = body.refresh === true;
  } catch {
    return fail("Solicitud inválida");
  }
  if (!Array.isArray(raw) || raw.length < 1 || (raw.length < 2 && !sameGame)) {
    return fail("Agrega al menos 2 partidos, o 1 con apuestas del mismo partido activadas.");
  }
  if (raw.length > MAX_PARLAY_GAMES) return fail(`Máximo ${MAX_PARLAY_GAMES} partidos por análisis.`);

  const resolved = await Promise.all(raw.map(resolveGame));
  const missingIdx = resolved.findIndex((g) => !g);
  if (missingIdx >= 0) return fail(`No encontré "${raw[missingIdx]?.title ?? "un partido"}" en el calendario. Quítalo del boleto o recarga la lista.`, 404);
  const games = resolved as Game[];

  const comboMax = sameGame ? comboMaxSize(games.length, maxLegs) : 0;
  const keys = games.map((g) => parlayKey(g, describeMarkets(g.sport, mercados?.[g.sport]).ids, comboMax));
  const hits = refresh ? games.map(() => null) : await Promise.all(keys.map((k) => getCached<Entry>(k)));
  const pending = games.map((g, i) => ({ g, i })).filter(({ i }) => !hits[i]);
  const cached = games.length - pending.length;

  // Precio: cada partido nuevo cuesta más que uno que ya estaba en el caché.
  const tarifas = await getTarifas();
  const precio = pending.length * tarifas.parlay_partido + cached * tarifas.parlay_cache;
  const titulo = `Parlay: ${games.map((g) => g.title).join(" · ")}`;
  const c = await charge(user, precio, titulo);
  if (!c.ok) return fail(sinCreditos(c), 402);
  const cobrado = user.isAdmin ? 0 : precio;

  const entries: (Entry | null)[] = hits.map((h) => h?.result ?? null);
  let costo = 0;

  if (pending.length) {
    try {
      const fresh = await analyzeParlayGames(
        pending.map((p) => p.g),
        mercados,
        { sameGame, maxLegs, comboMax: comboMax || undefined },
      );
      costo = fresh.costo_usd ?? 0;
      for (const { g, i } of pending) {
        const juego = fresh.juegos.find((j) => j.id === g.id);
        if (!juego) continue;
        const entry: Entry = { juego, advertencias: fresh.advertencias, fuentes: fresh.fuentes };
        entries[i] = entry;
        const saved = await putAnalysis({ key: keys[i], kind: "parlay", game: g, result: entry, model: fresh.modelo, userId: user.id });
        await recordPicks(saved?.id ?? null, "parlay", g, [
          ...juego.opciones,
          ...(juego.combinadas ?? []).map((cb) => ({
            mercado: "Combinada",
            seleccion: cb.selecciones.map((s) => s.seleccion).join(" + "),
            selecciones: cb.selecciones,
            probabilidad: cb.probabilidad,
            cuota: cb.cuota,
            cuota_estimada: true,
          })),
        ]);
      }
    } catch (e) {
      const msg = aiErrorMessage(e);
      await refund(user, cobrado, titulo);
      await logConsulta({ userId: user.id, tipo: "parlay", titulo, creditos: 0, costo: 0, ok: false, error: msg });
      return fail(`${msg}${cobrado ? " No se te cobraron créditos." : ""}`, 500);
    }
  }

  // El id de un evento manual cambia por usuario: se devuelve con el id del boleto de quien pregunta.
  const juegos = entries.flatMap((e, i) => (e ? [{ ...e.juego, id: games[i].id }] : []));
  if (!juegos.length) {
    await refund(user, cobrado, titulo);
    await logConsulta({ userId: user.id, tipo: "parlay", titulo, creditos: 0, costo, ok: false, error: "Sin opciones legibles" });
    return fail("La IA no devolvió opciones legibles. Intenta de nuevo; no se te cobraron créditos.", 500);
  }
  await logConsulta({ userId: user.id, tipo: "parlay", titulo, creditos: cobrado, costo, cache: pending.length === 0 });
  // Se publican en la sección Apuestas (los ya publicados no se repiten).
  const publicados = await publishParlays({ games, juegos, minLegs, maxLegs, sameGame, userId: user.id }).catch(() => 0);

  const advertencias = [...new Set(entries.flatMap((e) => e?.advertencias ?? []))];
  const fuentes = [...new Map(entries.flatMap((e) => e?.fuentes ?? []).map((f) => [f.url, f])).values()].slice(0, 15);

  return NextResponse.json({
    juegos,
    advertencias,
    fuentes,
    cache: {
      hit: pending.length === 0,
      creado: hits.find(Boolean)?.created_at ?? new Date().toISOString(),
      nuevos: pending.length,
      deCache: cached,
    },
    restantes: c.saldo,
    publicados,
  });
}
