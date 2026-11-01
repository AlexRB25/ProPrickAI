import { NextResponse } from "next/server";
import { analyzeWinners, deadline, esTimeout, grupos, type Winner } from "@/lib/ai";
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
  const inicio = Date.now();
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
  const avisos: string[] = [];
  if (pending.length) {
    // Grupos de 6 al mismo tiempo para no pasar de los 300 s de Vercel.
    const signal = deadline(inicio);
    const resultados = await Promise.all(
      grupos(pending, 6).map((grupo) =>
        analyzeWinners(grupo.map((p) => p.g), signal).then(
          (r) => ({ grupo, r, e: null as unknown }),
          (e) => ({ grupo, r: null, e }),
        ),
      ),
    );
    for (const { grupo, r, e } of resultados) {
      if (!r) {
        avisos.push(esTimeout(e) ? `No alcanzó el tiempo para: ${grupo.map((p) => p.g.title).join(", ")}.` : aiErrorMessage(e));
        continue;
      }
      costo += r.costo_usd ?? 0;
      for (const { g, i } of grupo) {
        const juego = r.juegos.find((j) => j.id === g.id);
        if (!juego?.ganador) continue;
        const entry: Entry = { juego, advertencias: r.advertencias };
        entries[i] = entry;
        const saved = await putAnalysis({ key: keys[i], kind: "ganador", game: g, result: entry, model: r.modelo, userId: user.id });
        // Cada pronóstico es un pick más: entra a Efectividad y a la sección Apuestas.
        await recordPicks(saved?.id ?? null, "partido", g, [
          { mercado: "Ganador", seleccion: `${juego.ganador} gana`, probabilidad: juego.probabilidad, cuota: juego.cuota, cuota_estimada: !juego.cuota },
        ]);
      }
    }
  }

  // Se cobra solo lo entregado.
  const sinAnalisis = pending.filter(({ i }) => !entries[i]);
  const devolver = user.isAdmin ? 0 : sinAnalisis.length * tarifas.ganador_partido;
  let devuelto = 0;
  if (devolver > 0 && devolver < cobrado) {
    await refund(user, devolver, `${titulo} (sin analizar: ${sinAnalisis.length})`);
    devuelto = devolver;
    c.saldo = c.saldo == null ? null : c.saldo + devolver;
  }
  if (sinAnalisis.length) {
    avisos.unshift(`${sinAnalisis.length} partido(s) no se pudieron analizar${devuelto ? ` y se te devolvieron ${devuelto} créditos` : ""}.`);
  }

  // Con el id del boleto de quien pregunta (los eventos manuales cambian de id por usuario).
  const juegos = entries
    .flatMap((e, i) => (e ? [{ ...e.juego, id: games[i].id, partido: games[i].title, fecha: games[i].date, sport: games[i].sport, liga: games[i].leagueName }] : []))
    .sort((a, b) => b.probabilidad - a.probabilidad);
  if (!juegos.length) {
    await refund(user, cobrado - devuelto, titulo);
    await logConsulta({ userId: user.id, tipo: "ganadores", titulo, creditos: 0, costo, ok: false, error: "Sin pronósticos legibles" });
    return fail(`${avisos.slice(1).join(" ") || "La IA no devolvió pronósticos legibles."} Intenta de nuevo con menos partidos; no se te cobraron créditos.`, 500);
  }
  await logConsulta({ userId: user.id, tipo: "ganadores", titulo, creditos: cobrado - devuelto, costo, cache: pending.length === 0, ok: !sinAnalisis.length, error: sinAnalisis.length ? avisos.join(" ") : undefined });

  return NextResponse.json({
    juegos,
    advertencias: [...avisos, ...new Set(entries.flatMap((e) => e?.advertencias ?? []))],
    cache: { hit: pending.length === 0, creado: hits.find(Boolean)?.created_at ?? new Date().toISOString(), nuevos: pending.length, deCache: cached },
    restantes: c.saldo,
  });
}
