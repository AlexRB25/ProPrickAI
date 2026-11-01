import { NextResponse } from "next/server";
import { analyzeParlayGames, deadline, esTimeout, grupos } from "@/lib/ai";
import { charge, getTarifas, hasAccess, logConsulta, refund, SIN_SUSCRIPCION, sinCreditos } from "@/lib/billing";
import { getCached, parlayKey, putAnalysis, recordPicks, resolveGame } from "@/lib/cache";
import type { Game } from "@/lib/espn";
import { describeMarkets, isExtended, type MarketSelection } from "@/lib/markets";
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
  const inicio = Date.now();
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
  const avisos: string[] = [];

  if (pending.length) {
    // En grupos chicos y al mismo tiempo: tarda lo que tarda un grupo, no la suma de todos
    // (con muchos partidos y mercados, una sola llamada pasaba de los 300 s de Vercel).
    const pesado = pending.some(({ g }) => isExtended(describeMarkets(g.sport, mercados?.[g.sport]).ids));
    const signal = deadline(inicio);
    const resultados = await Promise.all(
      grupos(pending, pesado ? 2 : 3).map((grupo) =>
        analyzeParlayGames(
          grupo.map((p) => p.g),
          mercados,
          { sameGame, maxLegs, comboMax: comboMax || undefined, signal },
        ).then(
          (r) => ({ grupo, r, e: null as unknown }),
          (e) => ({ grupo, r: null, e }),
        ),
      ),
    );

    for (const { grupo, r, e } of resultados) {
      if (!r) {
        avisos.push(esTimeout(e) ? `No alcanzó el tiempo para analizar: ${grupo.map((p) => p.g.title).join(", ")}.` : aiErrorMessage(e));
        continue;
      }
      costo += r.costo_usd ?? 0;
      for (const { g, i } of grupo) {
        const juego = r.juegos.find((j) => j.id === g.id);
        if (!juego) continue;
        const entry: Entry = { juego, advertencias: r.advertencias, fuentes: r.fuentes };
        entries[i] = entry;
        const saved = await putAnalysis({ key: keys[i], kind: "parlay", game: g, result: entry, model: r.modelo, userId: user.id });
        await recordPicks(saved?.id ?? null, "parlay", g, [
          ...juego.opciones,
          ...(juego.combinadas ?? []).map((cb) => ({
            mercado: "Combinada",
            seleccion: cb.selecciones.map((x) => x.seleccion).join(" + "),
            selecciones: cb.selecciones,
            probabilidad: cb.probabilidad,
            cuota: cb.cuota,
            cuota_estimada: true,
          })),
        ]);
      }
    }
  }

  // Se cobra solo lo que se entregó: cada partido que quedó sin análisis se devuelve.
  const sinAnalisis = pending.filter(({ i }) => !entries[i]);
  const devolver = user.isAdmin ? 0 : sinAnalisis.length * tarifas.parlay_partido;
  let devuelto = 0;
  if (devolver > 0 && devolver < cobrado) {
    await refund(user, devolver, `${titulo} (sin analizar: ${sinAnalisis.length})`);
    devuelto = devolver;
    c.saldo = c.saldo == null ? null : c.saldo + devolver;
  }
  if (sinAnalisis.length) {
    avisos.unshift(`${sinAnalisis.length} partido(s) no se pudieron analizar${devolver ? ` y se te devolvieron ${devolver} créditos` : ""}. Intenta de nuevo con menos partidos o menos mercados.`);
  }

  // El id de un evento manual cambia por usuario: se devuelve con el id del boleto de quien pregunta.
  const juegos = entries.flatMap((e, i) => (e ? [{ ...e.juego, id: games[i].id }] : []));
  if (!juegos.length) {
    await refund(user, cobrado - devuelto, titulo);
    await logConsulta({ userId: user.id, tipo: "parlay", titulo, creditos: 0, costo, ok: false, error: avisos.join(" ") || "Sin opciones legibles" });
    return fail(`${avisos.slice(1).join(" ") || "La IA no devolvió opciones legibles."} Intenta con menos partidos o menos mercados; no se te cobraron créditos.`, 500);
  }
  await logConsulta({ userId: user.id, tipo: "parlay", titulo, creditos: cobrado - devuelto, costo, cache: pending.length === 0, ok: !sinAnalisis.length, error: sinAnalisis.length ? avisos.join(" ") : undefined });
  // Se publican en la sección Apuestas (los ya publicados no se repiten).
  const publicados = await publishParlays({ games, juegos, minLegs, maxLegs, sameGame, userId: user.id }).catch(() => 0);

  const advertencias = [...avisos, ...new Set(entries.flatMap((e) => e?.advertencias ?? []))];
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
