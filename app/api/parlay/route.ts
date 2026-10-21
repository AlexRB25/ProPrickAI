import { NextResponse } from "next/server";
import { analyzeParlayGames } from "@/lib/ai";
import { getCached, parlayKey, putAnalysis, recordPicks, resolveGame } from "@/lib/cache";
import type { Game } from "@/lib/espn";
import { describeMarkets, type MarketSelection } from "@/lib/markets";
import { comboMaxSize, type GameOptions } from "@/lib/parlay";
import { aiErrorMessage, DAILY_LIMIT, fail, quotaOut, refundQuota, remainingQuota, requireUser, useQuota } from "@/lib/server";

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

  let raw: Game[];
  let mercados: MarketSelection | undefined;
  let sameGame = true;
  let maxLegs = 4;
  let refresh = false;
  try {
    const body = await req.json();
    raw = body.games;
    mercados = body.mercados;
    sameGame = body.sameGame !== false;
    maxLegs = Math.min(20, Math.max(2, Number(body.maxLegs) || 4));
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

  const entries: (Entry | null)[] = hits.map((h) => h?.result ?? null);
  let left = await remainingQuota(user);

  if (pending.length) {
    const q = await useQuota(user);
    if (q === null) return fail(`Llegaste a tu límite de ${DAILY_LIMIT} análisis de IA por hoy. Lo que ya esté en caché no cuenta.`, 429);
    left = q;
    try {
      const fresh = await analyzeParlayGames(
        pending.map((p) => p.g),
        mercados,
        { sameGame, maxLegs, comboMax: comboMax || undefined },
      );
      for (const { g, i } of pending) {
        const juego = fresh.juegos.find((j) => j.id === g.id);
        if (!juego) continue;
        const entry: Entry = { juego, advertencias: fresh.advertencias, fuentes: fresh.fuentes };
        entries[i] = entry;
        const saved = await putAnalysis({ key: keys[i], kind: "parlay", game: g, result: entry, model: fresh.modelo, userId: user.id });
        await recordPicks(saved?.id ?? null, "parlay", g, [
          ...juego.opciones,
          ...(juego.combinadas ?? []).map((c) => ({
            mercado: "Combinada",
            seleccion: c.selecciones.map((s) => s.seleccion).join(" + "),
            selecciones: c.selecciones,
            probabilidad: c.probabilidad,
            cuota: c.cuota,
            cuota_estimada: true,
          })),
        ]);
      }
    } catch (e) {
      await refundQuota(user);
      return fail(aiErrorMessage(e), 500);
    }
  }

  // El id de un evento manual cambia por usuario: se devuelve con el id del boleto de quien pregunta.
  const juegos = entries.flatMap((e, i) => (e ? [{ ...e.juego, id: games[i].id }] : []));
  if (!juegos.length) return fail("La IA no devolvió opciones legibles. Intenta de nuevo.", 500);
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
      deCache: games.length - pending.length,
    },
    restantes: quotaOut(left),
  });
}
