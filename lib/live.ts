// Estado y marcador en vivo de partidos de ESPN (por empezar, en juego o terminado). Solo servidor.
import { LEAGUES, type Game } from "./espn";

export interface Live {
  state: "pre" | "in" | "post";
  detalle: string; // "Q3 7:21", "45'", "Final"…
  marcador: string; // "NE 24 - 30 CHI"
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

function sideName(c: any) {
  return c?.team?.abbreviation || c?.team?.shortDisplayName || c?.athlete?.shortName || c?.athlete?.displayName || "?";
}

function fromCompetition(comp: any, ev: any): Live {
  const st = comp?.status?.type ?? ev?.status?.type ?? {};
  const cs: any[] = comp?.competitors ?? [];
  const away = cs.find((c) => c.homeAway === "away") ?? cs[1];
  const home = cs.find((c) => c.homeAway === "home") ?? cs[0];
  let marcador = "";
  if (cs.length === 2 && (away?.score != null || home?.score != null)) {
    marcador = `${sideName(away)} ${away?.score ?? 0} - ${home?.score ?? 0} ${sideName(home)}`;
  } else if (cs.length === 2 && (away?.linescores?.length || home?.linescores?.length)) {
    // Tenis: sin marcador total, va set por set (4-6, 6-3…).
    const a: any[] = away?.linescores ?? [];
    const h: any[] = home?.linescores ?? [];
    const sets = Array.from({ length: Math.max(a.length, h.length) }, (_, i) => `${a[i]?.value ?? 0}-${h[i]?.value ?? 0}`).join(", ");
    marcador = `${sideName(away)} vs ${sideName(home)}: ${sets}`;
  }
  return { state: st.state === "in" || st.state === "post" ? st.state : "pre", detalle: st.shortDetail ?? st.detail ?? "", marcador };
}

async function scoreboard(path: string, dates: string): Promise<any[]> {
  try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${dates}`, { next: { revalidate: 30 } });
    return res.ok ? ((await res.json()).events ?? []) : [];
  } catch {
    return [];
  }
}

/**
 * Estado de cada partido por id (evento o, en tenis y peleas, cada partido/pelea).
 * Se consulta el marcador de ESPN del día del partido (en horario de EE. UU., como lo agrupa ESPN).
 */
export async function liveStatus(games: Pick<Game, "league" | "id" | "date" | "manual">[]): Promise<Map<string, Live>> {
  const out = new Map<string, Live>();
  const wanted = new Set(games.filter((g) => !g.manual).map((g) => g.id));
  const jobs = new Map<string, string[]>(); // path → fechas
  for (const g of games) {
    if (g.manual) continue;
    const league = LEAGUES.find((l) => l.id === g.league);
    if (!league) continue;
    const t = Date.parse(g.date);
    if (!Number.isFinite(t)) continue;
    const dates = jobs.get(league.path) ?? [];
    for (const d of [ymd(new Date(t - 5 * 3600000)), ymd(new Date(t))]) if (!dates.includes(d)) dates.push(d);
    jobs.set(league.path, dates);
  }
  const pages = await Promise.all(
    [...jobs].flatMap(([path, dates]) => dates.map((d) => scoreboard(path, d))),
  );
  for (const ev of pages.flat()) {
    const comps: any[] = [...(ev.competitions ?? []), ...(ev.groupings ?? []).flatMap((g: any) => g.competitions ?? [])];
    if (wanted.has(String(ev.id))) out.set(String(ev.id), fromCompetition(ev.competitions?.[0], ev));
    for (const c of comps) if (wanted.has(String(c.id)) && !out.has(String(c.id))) out.set(String(c.id), fromCompetition(c, ev));
  }
  return out;
}

const HOURS = 3600000;

/**
 * ¿Ya terminó? Con dato de ESPN se usa su estado; sin él (eventos manuales o sin datos), se da por
 * terminado unas horas después del inicio (días si es un torneo o carrera).
 */
export function terminado(g: Pick<Game, "date" | "kind" | "manual">, live: Live | undefined): boolean {
  if (live) return live.state === "post";
  const margen = g.kind === "field" ? 4 * 24 * HOURS : 6 * HOURS;
  return Date.now() > Date.parse(g.date) + margen;
}
