import { NextResponse } from "next/server";
import { analyzeWinners, type Winner } from "@/lib/ai";
import { charge, getTarifas, hasAccess, logConsulta, refund, SIN_SUSCRIPCION, sinCreditos } from "@/lib/billing";
import { ganadorKey, getCached, putAnalysis, recordPicks, resolveGame } from "@/lib/cache";
import type { Game } from "@/lib/espn";
import { aiErrorMessage, fail, requireUser } from "@/lib/server";

// Tope del plan Hobby de Vercel.
export const maxDuration = 300;

const MAX_GAMES = 20;

interface Entry {
  juego: Winner;
  advertencias: string[];
}

/**
 * Solo quién gana: para cada partido del boleto, el ganador más probable, su probabilidad y por qué.
 * Se devuelven ordenados de mayor a menor probabilidad. No arma parlays.
 */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (user instanceof NextResponse) return user;
  if (!(await hasAccess(user))) return fail(SIN_SUSCRIPCION, 402);

  let raw: Game[];
  let refresh = false;
  try {
    const body = await req.json();
    raw = body.games;
    refresh = body.refresh === true;
  } catch {
    return fail("Solicitud inválida");
  }
  if (!Array.isArray(raw) || raw.length < 1) return fail("Agrega al menos un partido.");
  if (raw.length > MAX_GAMES) return fail(`Máximo ${MAX_GAMES} partidos por consulta.`);

  const resolved = await Promise.all(raw.map(resolveGame));
  const missingIdx = resolved.findIndex((g) => !g);
  if (missingIdx >= 0) return fail(`No encontré "${raw[missingIdx]?.title ?? "un partido"}" en el calendario. Quítalo del boleto o recarga la lista.`, 404);
  const games = resolved as Game[];

  const keys = games.map(ganadorKey);
  const hits = refresh ? games.map(() => null) : await Promise.all(keys.map((k) => getCached<Entry>(k)));
  const pending = games.map((g, i) => ({ g, i })).filter(({ i }) => !hits[i]);
  const cached = games.length - pending.length;

  const tarifas = await getTarifas();
  const precio = pending.length * tarifas.ganador_partido + cached * tarifas.ganador_cache;
  const titulo = `Ganadores: ${games.map((g) => g.title).join(" · ")}`;
  const c = await charge(user, precio, titulo);
  if (!c.ok) return fail(sinCreditos(c), 402);
  const cobrado = user.isAdmin ? 0 : precio;

  const entries: (Entry | null)[] = hits.map((h) => h?.result ?? null);
  let costo = 0;
  if (pending.length) {
    try {
      const fresh = await analyzeWinners(pending.map((p) => p.g));
      costo = fresh.costo_usd ?? 0;
      for (const { g, i } of pending) {
        const juego = fresh.juegos.find((j) => j.id === g.id);
        if (!juego?.ganador) continue;
        const entry: Entry = { juego, advertencias: fresh.advertencias };
        entries[i] = entry;
        const saved = await putAnalysis({ key: keys[i], kind: "ganador", game: g, result: entry, model: fresh.modelo, userId: user.id });
        // Cada pronóstico es un pick más: entra a Efectividad y a la sección Apuestas.
        await recordPicks(saved?.id ?? null, "partido", g, [
          { mercado: "Ganador", seleccion: `${juego.ganador} gana`, probabilidad: juego.probabilidad, cuota: juego.cuota, cuota_estimada: !juego.cuota },
        ]);
      }
    } catch (e) {
      const msg = aiErrorMessage(e);
      await refund(user, cobrado, titulo);
      await logConsulta({ userId: user.id, tipo: "ganadores", titulo, creditos: 0, costo: 0, ok: false, error: msg });
      return fail(`${msg}${cobrado ? " No se te cobraron créditos." : ""}`, 500);
    }
  }

  // Con el id del boleto de quien pregunta (los eventos manuales cambian de id por usuario).
  const juegos = entries
    .flatMap((e, i) => (e ? [{ ...e.juego, id: games[i].id, partido: games[i].title, fecha: games[i].date, sport: games[i].sport, liga: games[i].leagueName }] : []))
    .sort((a, b) => b.probabilidad - a.probabilidad);
  if (!juegos.length) {
    await refund(user, cobrado, titulo);
    await logConsulta({ userId: user.id, tipo: "ganadores", titulo, creditos: 0, costo, ok: false, error: "Sin pronósticos legibles" });
    return fail("La IA no devolvió pronósticos legibles. Intenta de nuevo; no se te cobraron créditos.", 500);
  }
  await logConsulta({ userId: user.id, tipo: "ganadores", titulo, creditos: cobrado, costo, cache: pending.length === 0 });

  return NextResponse.json({
    juegos,
    advertencias: [...new Set(entries.flatMap((e) => e?.advertencias ?? []))],
    cache: { hit: pending.length === 0, creado: hits.find(Boolean)?.created_at ?? new Date().toISOString(), nuevos: pending.length, deCache: cached },
    restantes: c.saldo,
  });
}
