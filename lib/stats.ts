// Últimos partidos reales de cada equipo (box scores de ESPN): córners, faltas, tarjetas,
// goles de campo, yardas y números de jugadores. Se le pasan a la IA como datos duros
// para que no dependa de encontrarlos buscando.
import { LEAGUES, type Game, type Sport } from "./espn";

/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = "https://site.api.espn.com/apis/site/v2/sports";

async function summary(path: string, eventId: string): Promise<any | null> {
  try {
    const res = await fetch(`${BASE}/${path}/summary?event=${eventId}`, { next: { revalidate: 3600 } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// Corre las tareas de a pocas para no saturar a ESPN.
export async function pool<T>(tasks: (() => Promise<T>)[], size = 8): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, tasks.length) }, async () => {
      while (i < tasks.length) {
        const k = i++;
        out[k] = await tasks[k]();
      }
    }),
  );
  return out;
}

const num = (v: unknown) => {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);

function teamStats(box: any, teamId: string) {
  const teams: any[] = box?.boxscore?.teams ?? [];
  const mine = teams.find((t) => String(t.team?.id) === teamId);
  const opp = teams.find((t) => String(t.team?.id) !== teamId);
  const toMap = (t: any) => Object.fromEntries((t?.statistics ?? []).map((s: any) => [s.name, s.displayValue]));
  return { mine: toMap(mine), opp: toMap(opp), oppName: opp?.team?.displayName ?? "?" };
}

// Filas de una categoría de jugadores: [{ nombre, valores por etiqueta }]
function playerRows(box: any, teamId: string, category?: string) {
  const team = (box?.boxscore?.players ?? []).find((p: any) => String(p.team?.id) === teamId);
  const cats: any[] = team?.statistics ?? [];
  const cat = category ? cats.find((c) => c.name === category) : cats[0];
  if (!cat) return [];
  return (cat.athletes ?? []).map((a: any) => {
    const v: Record<string, string> = {};
    (cat.labels ?? []).forEach((l: string, i: number) => (v[l] = a.stats?.[i] ?? ""));
    return { nombre: a.athlete?.shortName ?? a.athlete?.displayName ?? "?", v };
  });
}

function gameLine(sport: Sport, box: any, teamId: string, ev: any): { line: string; nums: Record<string, number> } {
  const { mine, opp, oppName } = teamStats(box, teamId);
  const home = String(ev.homeTeamId) === teamId;
  const gf = home ? ev.homeTeamScore : ev.awayTeamScore;
  const ga = home ? ev.awayTeamScore : ev.homeTeamScore;
  const head = `vs ${oppName} (${home ? "L" : "V"}) ${ev.gameResult ?? ""} ${gf}-${ga}`;
  const nums: Record<string, number> = { favor: num(gf), contra: num(ga) };

  if (sport === "soccer") {
    Object.assign(nums, {
      cornersFavor: num(mine.wonCorners), cornersContra: num(opp.wonCorners),
      faltas: num(mine.foulsCommitted), faltasRecibidas: num(opp.foulsCommitted),
      amarillas: num(mine.yellowCards), amarillasRival: num(opp.yellowCards),
      tiros: num(mine.totalShots), aGol: num(mine.shotsOnTarget), aGolRival: num(opp.shotsOnTarget),
    });
    return {
      nums,
      line: `${head} · córners ${mine.wonCorners ?? "?"}-${opp.wonCorners ?? "?"} · faltas ${mine.foulsCommitted ?? "?"}-${opp.foulsCommitted ?? "?"} · amarillas ${mine.yellowCards ?? "?"}-${opp.yellowCards ?? "?"}${num(mine.redCards) ? ` · rojas ${mine.redCards}` : ""} · tiros ${mine.totalShots ?? "?"} (${mine.shotsOnTarget ?? "?"} a gol) vs ${opp.totalShots ?? "?"} (${opp.shotsOnTarget ?? "?"})`,
    };
  }

  if (sport === "americano") {
    const pass = playerRows(box, teamId, "passing").slice(0, 1).map((p: any) => `${p.nombre} ${p.v["C/ATT"]} ${p.v.YDS} yds ${p.v.TD} TD ${p.v.INT} INT`);
    const rush = playerRows(box, teamId, "rushing").slice(0, 2).map((p: any) => `${p.nombre} ${p.v.CAR}-${p.v.YDS}${num(p.v.TD) ? ` ${p.v.TD} TD` : ""}`);
    const rec = playerRows(box, teamId, "receiving").slice(0, 3).map((p: any) => `${p.nombre} ${p.v.REC}-${p.v.YDS}${num(p.v.TD) ? ` ${p.v.TD} TD` : ""}`);
    const kick = playerRows(box, teamId, "kicking").slice(0, 1).map((p: any) => `${p.nombre} FG ${p.v.FG} (larga ${p.v.LONG}), ${p.v.PTS} pts`);
    const fg = (playerRows(box, teamId, "kicking")[0]?.v.FG ?? "0/0").split("/");
    const sacks = String(opp.sacksYardsLost ?? "0-0").split("-")[0];
    Object.assign(nums, {
      yardas: num(mine.totalYards), pase: num(mine.netPassingYards), carrera: num(mine.rushingYards),
      paseRival: num(opp.netPassingYards), carreraRival: num(opp.rushingYards),
      fgHechos: num(fg[0]), fgIntentos: num(fg[1]), sacksHechos: num(sacks),
    });
    return {
      nums,
      line: `${head} · yardas ${mine.totalYards ?? "?"} (pase ${mine.netPassingYards ?? "?"}, carrera ${mine.rushingYards ?? "?"}); permitió pase ${opp.netPassingYards ?? "?"}, carrera ${opp.rushingYards ?? "?"} · zona roja ${mine.redZoneAttempts ?? "?"} · sacks hechos ${sacks}${pass.length ? ` · QB: ${pass.join("")}` : ""}${rush.length ? ` · carrera: ${rush.join(", ")}` : ""}${rec.length ? ` · recepción: ${rec.join(", ")}` : ""}${kick.length ? ` · pateador: ${kick.join("")}` : ""}`,
    };
  }

  if (sport !== "basquet") {
    // Otros deportes de equipo (béisbol, hockey, rugby…): las estadísticas que traiga ESPN.
    const keys = Object.keys(mine).slice(0, 12);
    return { nums, line: `${head}${keys.length ? ` · ${keys.map((k) => `${k} ${mine[k]}-${opp[k] ?? "?"}`).join(" · ")}` : ""}` };
  }

  // básquet
  const leaders = playerRows(box, teamId)
    .filter((p: any) => p.v.MIN && p.v.MIN !== "0")
    .sort((a: any, b: any) => num(b.v.PTS) - num(a.v.PTS))
    .slice(0, 5)
    .map((p: any) => `${p.nombre} ${p.v.PTS} pts/${p.v.REB} reb/${p.v.AST} ast/${String(p.v["3PT"] ?? "").split("-")[0]} triples (${p.v.MIN} min)`);
  Object.assign(nums, { rebotes: num(mine.totalRebounds), asistencias: num(mine.assists), faltas: num(mine.fouls) });
  return {
    nums,
    line: `${head} · reb ${mine.totalRebounds ?? "?"} · ast ${mine.assists ?? "?"} · triples ${mine["threePointFieldGoalsMade-threePointFieldGoalsAttempted"] ?? "?"} · faltas ${mine.fouls ?? "?"} · pérdidas ${mine.totalTurnovers ?? "?"} · ${leaders.join("; ")}`,
  };
}

function averages(sport: Sport, rows: Record<string, number>[]) {
  const a = (k: string) => avg(rows.map((r) => r[k] ?? 0));
  if (sport === "soccer") {
    return `Promedios: goles ${a("favor")}-${a("contra")}, córners a favor ${a("cornersFavor")} y en contra ${a("cornersContra")}, faltas cometidas ${a("faltas")} y recibidas ${a("faltasRecibidas")}, amarillas ${a("amarillas")} (rival ${a("amarillasRival")}), tiros a gol ${a("aGol")} (permitidos ${a("aGolRival")}).`;
  }
  if (sport === "americano") {
    const fgH = rows.reduce((n, r) => n + (r.fgHechos ?? 0), 0);
    const fgI = rows.reduce((n, r) => n + (r.fgIntentos ?? 0), 0);
    return `Promedios: puntos ${a("favor")}-${a("contra")}, yardas ${a("yardas")} (pase ${a("pase")}, carrera ${a("carrera")}), permitió pase ${a("paseRival")} y carrera ${a("carreraRival")}, sacks ${a("sacksHechos")}, goles de campo ${fgH}/${fgI} en total (${a("fgHechos")} por partido).`;
  }
  if (sport !== "basquet") return `Promedios: marcador ${a("favor")}-${a("contra")}.`;
  return `Promedios: puntos ${a("favor")}-${a("contra")}, rebotes ${a("rebotes")}, asistencias ${a("asistencias")}, faltas ${a("faltas")}.`;
}

// Texto con los últimos `n` partidos de ambos equipos; vacío si ESPN no tiene datos.
export async function recentForm(game: Game, n = 5): Promise<string> {
  if (game.manual || game.kind !== "match") return "";
  const league = LEAGUES.find((l) => l.id === game.league);
  if (!league) return "";
  const sum = await summary(league.path, game.id);
  const teams: any[] = sum?.lastFiveGames ?? [];
  if (!teams.length) return "";

  const blocks = await Promise.all(
    teams.map(async (t) => {
      const teamId = String(t.team?.id);
      const events: any[] = [...(t.events ?? [])]
        .sort((a, b) => String(b.gameDate ?? "").localeCompare(String(a.gameDate ?? "")))
        .slice(0, n);
      const boxes = await pool(events.map((ev) => () => summary(league.path, String(ev.id))));
      const parsed = events
        .map((ev, i) => (boxes[i]?.boxscore?.teams?.length ? gameLine(game.sport, boxes[i], teamId, ev) : null))
        .filter((x): x is NonNullable<typeof x> => x != null);
      if (!parsed.length) return "";
      return [
        `${t.team?.displayName} — últimos ${parsed.length} partidos (más reciente primero):`,
        ...parsed.map((p) => `- ${p.line}`),
        averages(game.sport, parsed.map((p) => p.nums)),
      ].join("\n");
    }),
  );
  const text = blocks.filter(Boolean).join("\n\n");
  return text
    ? `Datos reales de los últimos partidos (box scores de ESPN; pueden incluir copa o pretemporada, fíjate en los minutos jugados):\n${text}`
    : "";
}

/**
 * Resultado final oficial de un partido de ESPN para calificar picks: marcador, estadísticas de
 * equipo y de cada jugador. final=false si todavía no termina; null si ESPN no tiene el partido.
 */
export async function finalReport(game: Game): Promise<{ final: boolean; text: string } | null> {
  if (game.manual) return null;
  const league = LEAGUES.find((l) => l.id === game.league);
  if (!league) return null;
  const s = await summary(league.path, game.id);
  const comp = s?.header?.competitions?.[0];
  if (!comp) return null;
  const st = comp.status?.type ?? {};
  if (!st.completed) return { final: false, text: st.description ?? "" };
  if (/postponed|canceled|cancelled|suspended|abandoned/i.test(`${st.name} ${st.description}`)) {
    return { final: true, text: `Partido ${st.description} (no se jugó o no terminó).` };
  }

  const lines: string[] = [];
  const score = (comp.competitors ?? [])
    .map((c: any) => `${c.team?.displayName ?? c.athlete?.displayName} ${c.score ?? "?"}${c.winner ? " (ganó)" : ""}`)
    .join(" — ");
  lines.push(`Final (${st.detail ?? st.description ?? ""}): ${score}`);
  const periods = (comp.competitors ?? [])
    .map((c: any) => (c.linescores?.length ? `${c.team?.abbreviation ?? c.team?.displayName}: ${c.linescores.map((l: any) => l.displayValue ?? l.value).join(" | ")}` : ""))
    .filter(Boolean);
  if (periods.length) lines.push(`Por periodo: ${periods.join(" · ")}`);

  for (const t of s.boxscore?.teams ?? []) {
    const stats = (t.statistics ?? []).map((x: any) => `${x.label ?? x.name} ${x.displayValue}`).join(", ");
    if (stats) lines.push(`${t.team?.displayName} — ${stats}`);
  }
  for (const team of s.boxscore?.players ?? []) {
    for (const cat of team.statistics ?? []) {
      const rows = (cat.athletes ?? [])
        .filter((a: any) => (a.stats ?? []).some((v: string) => v && v !== "0" && v !== "--"))
        .map((a: any) => `${a.athlete?.displayName}: ${(cat.labels ?? []).map((l: string, i: number) => `${l} ${a.stats?.[i] ?? ""}`).join(" ")}`);
      if (rows.length) lines.push(`${team.team?.displayName} · ${cat.name ?? cat.text ?? "jugadores"}\n  ${rows.join("\n  ")}`);
    }
  }
  // Goles, tarjetas y cambios del soccer vienen como jugadas clave.
  const plays = (s.keyEvents ?? s.plays ?? [])
    .filter((p: any) => /goal|card|penalty|gol|tarjeta/i.test(p.type?.text ?? ""))
    .map((p: any) => `${p.clock?.displayValue ?? ""} ${p.type?.text}: ${p.text ?? ""}`);
  if (plays.length) lines.push(`Jugadas clave:\n  ${plays.slice(0, 40).join("\n  ")}`);

  return { final: true, text: lines.join("\n").slice(0, 30000) };
}
