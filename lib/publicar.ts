// Publica en la sección "Apuestas" los parlays que se armaron. Solo servidor.
import { pickKeyFor } from "./cache";
import type { Game } from "./espn";
import { buildParlays, type GameOptions } from "./parlay";
import { db } from "./server";

// Tope por consulta para no llenar la sección con variantes casi iguales.
const MAX_POR_CONSULTA = 8;

/**
 * Arma los mismos parlays que ve el usuario y guarda los nuevos. Un parlay ya publicado (mismos picks)
 * no se repite. Devuelve cuántos se publicaron.
 */
export async function publishParlays(opts: {
  games: Game[];
  juegos: GameOptions[];
  minLegs: number;
  maxLegs: number;
  sameGame: boolean;
  userId: string;
}): Promise<number> {
  const byId = new Map(opts.games.filter((g) => g.state !== "post").map((g) => [g.id, g]));
  const parlays = buildParlays(opts.juegos, opts.minLegs, opts.maxLegs, opts.sameGame).slice(0, MAX_POR_CONSULTA);
  if (!parlays.length) return 0;

  // pick_key de cada pierna (los picks ya se guardaron al analizar los partidos).
  const legKey = (gameId: string, sels: { mercado: string; seleccion: string }[]) => {
    const g = byId.get(gameId);
    if (!g) return null;
    return sels.length > 1
      ? pickKeyFor(g, { mercado: "Combinada", seleccion: sels.map((s) => s.seleccion).join(" + "), selecciones: sels })
      : pickKeyFor(g, { mercado: sels[0].mercado, seleccion: sels[0].seleccion });
  };
  const keys = [...new Set(parlays.flatMap((p) => p.piernas.map((l) => legKey(l.gameId, l.selecciones)).filter(Boolean) as string[]))];
  const { data } = await db().from("picks").select("id, pick_key").in("pick_key", keys);
  const idOf = new Map((data ?? []).map((r) => [r.pick_key, r.id as string]));

  const rows = [];
  for (const p of parlays) {
    const piernas = p.piernas.map((l) => {
      const k = legKey(l.gameId, l.selecciones);
      const g = byId.get(l.gameId);
      return {
        pick_id: k ? (idOf.get(k) ?? null) : null,
        partido: l.partido,
        sport: g?.sport ?? "",
        league_name: g?.leagueName.split(" · ")[0] ?? "",
        game_date: g?.date ?? null,
        selecciones: l.selecciones,
        probabilidad: l.probabilidad,
        cuota: l.cuota,
        cuota_estimada: l.cuota_estimada,
        razon: l.razon,
      };
    });
    if (piernas.some((x) => !x.pick_id || !x.game_date)) continue; // partido ya jugado o pick sin guardar
    const pickIds = piernas.map((x) => x.pick_id as string);
    rows.push({
      parlay_key: [...pickIds].sort().join("|"),
      tipo: p.tipo,
      piernas,
      pick_ids: pickIds,
      apuestas: p.apuestas,
      partidos: p.partidos,
      probabilidad: p.probabilidad,
      cuota_americana: p.cuotaAmericana || null,
      sports: [...new Set(piernas.map((x) => x.sport))],
      first_game: piernas.map((x) => x.game_date as string).sort()[0],
      created_by: opts.userId,
    });
  }
  if (!rows.length) return 0;
  const { data: saved, error } = await db().from("parlays").upsert(rows, { onConflict: "parlay_key", ignoreDuplicates: true }).select("id");
  if (error) console.error("No se publicaron los parlays:", error.message);
  return saved?.length ?? 0;
}
