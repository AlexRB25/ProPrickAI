// Caché compartido de análisis y registro de picks para la sección de efectividad.
import { createHash } from "node:crypto";
import { fetchGames, SPORTS, type Game } from "./espn";
import { db } from "./server";

export const norm = (s: string) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const sha = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

/**
 * El partido que manda el navegador no es confiable (se usa para el caché de todos), así que
 * los de ESPN se vuelven a leer de ESPN. Los manuales se limpian y se aceptan como vienen.
 */
export async function resolveGame(g: Game): Promise<Game | null> {
  if (!g || typeof g !== "object") return null;
  if (g.manual) {
    const sport = SPORTS.some((s) => s.id === g.sport) ? g.sport : "otro";
    const clip = (v: unknown, n: number) => String(v ?? "").slice(0, n);
    const side = (t: Game["home"]) => ({ name: clip(t?.name, 100), abbr: "", logo: "", record: "", form: "", moneyline: "" });
    const date = Number.isFinite(Date.parse(g.date)) ? new Date(g.date).toISOString() : new Date().toISOString();
    return {
      id: clip(g.id, 80),
      league: "manual",
      leagueName: clip(g.leagueName, 150),
      sport,
      kind: g.kind === "field" ? "field" : "match",
      title: clip(g.title, 200),
      date,
      state: "pre",
      status: "",
      venue: "",
      home: side(g.home),
      away: side(g.away),
      score: "",
      odds: { provider: "", details: "", overUnder: null, draw: "" },
      manual: true,
      notes: clip(g.notes, 500),
    };
  }
  try {
    return (await fetchGames(String(g.league))).find((x) => x.id === String(g.id)) ?? null;
  } catch {
    return null;
  }
}

/** Identidad estable del partido: ESPN por id; manuales por nombre + notas + día. */
export function gameKey(g: Game) {
  if (!g.manual) return `${g.league}:${g.id}`;
  return `manual:${g.sport}:${sha(`${norm(g.title)}|${norm(g.notes ?? "")}|${g.date.slice(0, 10)}`)}`;
}

/** Entre más cerca del partido, menos dura el análisis (lesiones, alineaciones y momios cambian). */
export function ttlMs(gameDate: string) {
  const left = Date.parse(gameDate) - Date.now();
  if (left > 2 * 86400000) return 12 * 3600000;
  if (left > 6 * 3600000) return 3 * 3600000;
  return 45 * 60000;
}

export function partidoKey(g: Game, marketIds: string[], question: string) {
  return `partido|${gameKey(g)}|${[...marketIds].sort().join(",")}|${question.trim() ? sha(norm(question)) : "-"}`;
}

export function ganadorKey(g: Game) {
  return `ganador|${gameKey(g)}`;
}

export function parlayKey(g: Game, marketIds: string[], comboMax: number) {
  return `parlay|${gameKey(g)}|${[...marketIds].sort().join(",")}|c${comboMax}`;
}

export interface Cached<T> {
  id: string;
  result: T;
  created_at: string;
}

export async function getCached<T>(key: string): Promise<Cached<T> | null> {
  const { data } = await db()
    .from("analyses")
    .select("id, result, created_at")
    .eq("cache_key", key)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Cached<T> | null) ?? null;
}

export async function putAnalysis(opts: {
  key: string;
  kind: "partido" | "parlay" | "ganador";
  game: Game;
  result: unknown;
  model: string;
  userId: string;
}): Promise<{ id: string; created_at: string } | null> {
  const { data, error } = await db()
    .from("analyses")
    .insert({
      cache_key: opts.key,
      kind: opts.kind,
      game_id: gameKey(opts.game),
      sport: opts.game.sport,
      league: opts.game.league,
      game_date: opts.game.date,
      result: opts.result,
      model: opts.model,
      created_by: opts.userId,
      expires_at: new Date(Date.now() + ttlMs(opts.game.date)).toISOString(),
    })
    .select("id, created_at")
    .single();
  if (error) console.error("No se guardó el análisis en caché:", error.message);
  return data;
}

export interface PickIn {
  mercado: string;
  seleccion: string;
  selecciones?: { mercado: string; seleccion: string }[];
  probabilidad: number;
  cuota: string;
  cuota_estimada: boolean;
}

/** Identidad única de un pick: partido + mercado + selección (o las selecciones de una combinada). */
export function pickKeyFor(game: Game, p: Pick<PickIn, "mercado" | "seleccion" | "selecciones">) {
  const combo = p.selecciones && p.selecciones.length > 1;
  const id = combo ? p.selecciones!.map((s) => norm(s.seleccion)).sort().join("+") : `${norm(p.mercado)}|${norm(p.seleccion)}`;
  return `${gameKey(game)}|${id}`;
}

/**
 * Guarda los picks una sola vez por partido y selección (los repetidos se ignoran).
 * Devuelve pick_key → id de todos, nuevos o ya existentes.
 */
export async function recordPicks(analysisId: string | null, origen: "partido" | "parlay", game: Game, picks: PickIn[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  if (game.state === "post" || picks.length === 0) return ids;
  const gk = gameKey(game);
  const rows = picks
    .filter((p) => p.seleccion.trim())
    .map((p) => {
      const combo = p.selecciones && p.selecciones.length > 1;
      const sel = combo ? p.selecciones!.map((s) => s.seleccion).join(" + ") : p.seleccion;
      return {
        pick_key: pickKeyFor(game, p),
        analysis_id: analysisId,
        origen,
        game_id: gk,
        game,
        sport: game.sport,
        league: game.league,
        league_name: game.leagueName.split(" · ")[0],
        title: game.title,
        game_date: game.date,
        mercado: combo ? "Combinada del mismo partido" : p.mercado.slice(0, 200),
        seleccion: sel.slice(0, 500),
        selecciones: combo ? p.selecciones : null,
        probabilidad: Math.max(1, Math.min(99, Math.round(p.probabilidad))),
        cuota: p.cuota.slice(0, 40),
        cuota_estimada: p.cuota_estimada,
      };
    });
  const { error } = await db().from("picks").upsert(rows, { onConflict: "pick_key", ignoreDuplicates: true });
  if (error) console.error("No se guardaron los picks:", error.message);
  const { data } = await db().from("picks").select("id, pick_key").in("pick_key", rows.map((r) => r.pick_key));
  for (const r of data ?? []) ids.set(r.pick_key, r.id);
  return ids;
}
