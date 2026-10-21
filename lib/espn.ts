// Deportes, ligas y partidos próximos con momios desde la API pública de ESPN (sin llave).
// Los deportes sin liga en ESPN se analizan como "evento manual" (la IA investiga en la web).

export type Sport = string;

export interface SportInfo {
  id: Sport;
  label: string;
  emoji: string;
}

export const SPORTS: SportInfo[] = [
  { id: "soccer", label: "Fútbol", emoji: "⚽" },
  { id: "americano", label: "Fútbol americano", emoji: "🏈" },
  { id: "beisbol", label: "Béisbol", emoji: "⚾" },
  { id: "basquet", label: "Básquetbol", emoji: "🏀" },
  { id: "tenis", label: "Tenis", emoji: "🎾" },
  { id: "hockey", label: "Hockey", emoji: "🏒" },
  { id: "esports", label: "eSports", emoji: "🎮" },
  { id: "box", label: "Box", emoji: "🥊" },
  { id: "mma", label: "UFC/MMA", emoji: "🤼" },
  { id: "motor", label: "Automovilismo", emoji: "🏎️" },
  { id: "golf", label: "Golf", emoji: "⛳" },
  { id: "tenis_mesa", label: "Tenis de mesa", emoji: "🏓" },
  { id: "voleibol", label: "Voleibol", emoji: "🏐" },
  { id: "badminton", label: "Bádminton", emoji: "🏸" },
  { id: "ciclismo", label: "Ciclismo", emoji: "🚴" },
  { id: "balonmano", label: "Balonmano", emoji: "🤾" },
  { id: "galgos", label: "Carreras de galgos", emoji: "🐕" },
  { id: "caballos", label: "Caballos", emoji: "🏇" },
  { id: "afl", label: "Fútbol australiano", emoji: "🏉" },
  { id: "rugby", label: "Rugby Union", emoji: "🏉" },
  { id: "rugby_league", label: "Rugby League", emoji: "🏉" },
  { id: "lacrosse", label: "Lacrosse", emoji: "🥍" },
  { id: "hockey_cesped", label: "Hockey sobre césped", emoji: "🏑" },
  { id: "futsal", label: "Fútbol de sala", emoji: "🥅" },
  { id: "criquet", label: "Críquet", emoji: "🏏" },
  { id: "invierno", label: "Deportes de invierno", emoji: "⛷️" },
  { id: "surf", label: "Surfing", emoji: "🏄" },
  { id: "snooker", label: "Snooker", emoji: "🎱" },
  { id: "dardos", label: "Dardos", emoji: "🎯" },
  { id: "entretenimiento", label: "Entretenimiento", emoji: "🎬" },
  { id: "politica", label: "Política", emoji: "🗳️" },
];

export const sportInfo = (id: Sport): SportInfo => SPORTS.find((s) => s.id === id) ?? { id, label: id, emoji: "🏅" };

// team: equipo vs equipo · fights: cada pelea de una función · tennis: cada partido del torneo
// field: torneo o carrera con muchos participantes (golf, automovilismo)
type Format = "team" | "fights" | "tennis" | "field";

export interface League {
  id: string;
  sport: Sport;
  name: string;
  path: string; // deporte/liga en la URL de ESPN
  format?: Format;
  weekly?: boolean; // ESPN ya devuelve la jornada/evento actual sin fechas
}

export const LEAGUES: League[] = [
  { id: "nfl", sport: "americano", name: "NFL", path: "football/nfl", weekly: true },
  { id: "ncaaf", sport: "americano", name: "NCAA Football", path: "football/college-football", weekly: true },
  { id: "cfl", sport: "americano", name: "CFL", path: "football/cfl" },
  { id: "ufl", sport: "americano", name: "UFL", path: "football/ufl" },

  { id: "mex.1", sport: "soccer", name: "Liga MX", path: "soccer/mex.1" },
  { id: "mex.2", sport: "soccer", name: "Liga de Expansión MX", path: "soccer/mex.2" },
  { id: "eng.1", sport: "soccer", name: "Premier League", path: "soccer/eng.1" },
  { id: "esp.1", sport: "soccer", name: "LaLiga", path: "soccer/esp.1" },
  { id: "ita.1", sport: "soccer", name: "Serie A", path: "soccer/ita.1" },
  { id: "ger.1", sport: "soccer", name: "Bundesliga", path: "soccer/ger.1" },
  { id: "fra.1", sport: "soccer", name: "Ligue 1", path: "soccer/fra.1" },
  { id: "por.1", sport: "soccer", name: "Primeira Liga", path: "soccer/por.1" },
  { id: "ned.1", sport: "soccer", name: "Eredivisie", path: "soccer/ned.1" },
  { id: "sco.1", sport: "soccer", name: "Premiership escocesa", path: "soccer/sco.1" },
  { id: "tur.1", sport: "soccer", name: "Superliga turca", path: "soccer/tur.1" },
  { id: "uefa.champions", sport: "soccer", name: "Champions League", path: "soccer/uefa.champions" },
  { id: "uefa.europa", sport: "soccer", name: "Europa League", path: "soccer/uefa.europa" },
  { id: "uefa.europa.conf", sport: "soccer", name: "Conference League", path: "soccer/uefa.europa.conf" },
  { id: "concacaf.champions", sport: "soccer", name: "Concacaf Champions Cup", path: "soccer/concacaf.champions" },
  { id: "conmebol.libertadores", sport: "soccer", name: "Copa Libertadores", path: "soccer/conmebol.libertadores" },
  { id: "usa.1", sport: "soccer", name: "MLS", path: "soccer/usa.1" },
  { id: "arg.1", sport: "soccer", name: "Liga Argentina", path: "soccer/arg.1" },
  { id: "bra.1", sport: "soccer", name: "Brasileirão", path: "soccer/bra.1" },
  { id: "col.1", sport: "soccer", name: "Liga Colombiana", path: "soccer/col.1" },

  { id: "mlb", sport: "beisbol", name: "MLB", path: "baseball/mlb" },
  { id: "college-baseball", sport: "beisbol", name: "NCAA Baseball", path: "baseball/college-baseball" },

  { id: "nba", sport: "basquet", name: "NBA", path: "basketball/nba" },
  { id: "wnba", sport: "basquet", name: "WNBA", path: "basketball/wnba" },
  { id: "ncaab", sport: "basquet", name: "NCAA Basketball", path: "basketball/mens-college-basketball" },
  { id: "ncaaw", sport: "basquet", name: "NCAA Women's Basketball", path: "basketball/womens-college-basketball" },
  { id: "fiba", sport: "basquet", name: "FIBA (selecciones)", path: "basketball/fiba" },

  { id: "atp", sport: "tenis", name: "ATP", path: "tennis/atp", format: "tennis", weekly: true },
  { id: "wta", sport: "tenis", name: "WTA", path: "tennis/wta", format: "tennis", weekly: true },

  { id: "nhl", sport: "hockey", name: "NHL", path: "hockey/nhl" },
  { id: "ncaah", sport: "hockey", name: "NCAA Hockey", path: "hockey/mens-college-hockey" },

  { id: "ufc", sport: "mma", name: "UFC", path: "mma/ufc", format: "fights", weekly: true },
  { id: "pfl", sport: "mma", name: "PFL", path: "mma/pfl", format: "fights", weekly: true },

  { id: "f1", sport: "motor", name: "Fórmula 1", path: "racing/f1", format: "field", weekly: true },
  { id: "nascar", sport: "motor", name: "NASCAR Cup", path: "racing/nascar-premier", format: "field", weekly: true },
  { id: "indycar", sport: "motor", name: "IndyCar", path: "racing/irl", format: "field", weekly: true },

  { id: "pga", sport: "golf", name: "PGA Tour", path: "golf/pga", format: "field", weekly: true },
  { id: "lpga", sport: "golf", name: "LPGA", path: "golf/lpga", format: "field", weekly: true },

  { id: "afl", sport: "afl", name: "AFL", path: "australian-football/afl" },

  { id: "rugby.premiership", sport: "rugby", name: "Premiership inglesa", path: "rugby/267979" },
  { id: "rugby.urc", sport: "rugby", name: "United Rugby Championship", path: "rugby/270557" },
  { id: "rugby.champions", sport: "rugby", name: "Champions Cup europea", path: "rugby/271937" },
  { id: "rugby.six", sport: "rugby", name: "Seis Naciones", path: "rugby/180659" },
  { id: "rugby.super", sport: "rugby", name: "Super Rugby Pacific", path: "rugby/242041" },
  { id: "rugby.tests", sport: "rugby", name: "Test matches", path: "rugby/289234" },

  { id: "nrl", sport: "rugby_league", name: "NRL", path: "rugby-league/3" },

  { id: "ncaavw", sport: "voleibol", name: "NCAA Voleibol femenil", path: "volleyball/womens-college-volleyball" },
  { id: "ncaavm", sport: "voleibol", name: "NCAA Voleibol varonil", path: "volleyball/mens-college-volleyball" },

  { id: "pll", sport: "lacrosse", name: "PLL", path: "lacrosse/pll" },
  { id: "ncaalax", sport: "lacrosse", name: "NCAA Lacrosse", path: "lacrosse/mens-college-lacrosse" },

  { id: "ncaafh", sport: "hockey_cesped", name: "NCAA Hockey sobre césped", path: "field-hockey/womens-college-field-hockey" },
];

export const leaguesOf = (sport: Sport) => LEAGUES.filter((l) => l.sport === sport);

export interface TeamSide {
  name: string;
  abbr: string;
  logo: string;
  record: string;
  form: string;
  moneyline: string;
}

export interface Game {
  id: string;
  league: string;
  leagueName: string;
  sport: Sport;
  kind: "match" | "field";
  title: string;
  date: string;
  state: "pre" | "in" | "post";
  status: string;
  venue: string;
  home: TeamSide;
  away: TeamSide;
  field?: string[]; // participantes de un torneo o carrera
  score: string;
  odds: { provider: string; details: string; overUnder: number | null; draw: string };
  manual?: boolean; // evento escrito por el usuario, sin datos de ESPN
  notes?: string;
}

const EMPTY_SIDE: TeamSide = { name: "", abbr: "", logo: "", record: "", form: "", moneyline: "" };
const NO_ODDS = { provider: "", details: "", overUnder: null, draw: "" };

/* eslint-disable @typescript-eslint/no-explicit-any */
function side(c: any, ml: any): TeamSide {
  const athlete = c?.athlete;
  return {
    name: c?.team?.displayName ?? athlete?.displayName ?? "?",
    abbr: c?.team?.abbreviation ?? "",
    logo: c?.team?.logo ?? athlete?.flag?.href ?? "",
    record: c?.records?.[0]?.summary ?? (c?.seed ? `cabeza de serie ${c.seed}` : ""),
    form: c?.form ?? "",
    moneyline: ml?.close?.odds ?? ml?.open?.odds ?? "",
  };
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function teamGame(league: League, e: any): Game {
  const comp = e.competitions?.[0] ?? {};
  const odds = comp.odds?.[0] ?? {};
  const home = comp.competitors?.find((c: any) => c.homeAway === "home") ?? comp.competitors?.[0];
  const away = comp.competitors?.find((c: any) => c.homeAway === "away") ?? comp.competitors?.[1];
  const state = e.status?.type?.state ?? "pre";
  const h = side(home, odds.moneyline?.home);
  const a = side(away, odds.moneyline?.away);
  return {
    id: String(e.id),
    league: league.id,
    leagueName: league.name,
    sport: league.sport,
    kind: "match",
    title: `${a.name} vs ${h.name}`,
    date: e.date,
    state,
    status: e.status?.type?.shortDetail ?? "",
    venue: comp.venue?.fullName ?? "",
    home: h,
    away: a,
    score: state === "pre" ? "" : `${away?.score ?? ""} - ${home?.score ?? ""}`,
    odds: {
      provider: odds.provider?.displayName ?? odds.provider?.name ?? "",
      details: odds.details ?? "",
      overUnder: typeof odds.overUnder === "number" ? odds.overUnder : null,
      draw: odds.moneyline?.draw?.close?.odds ?? odds.drawOdds?.moneyLine?.toString() ?? "",
    },
  };
}

// Una pelea o un partido de tenis dentro de una función/torneo.
function bout(league: League, e: any, c: any, extra: string): Game {
  const [x, y] = c.competitors ?? [];
  const a = side(x, null);
  const h = side(y, null);
  const state = c.status?.type?.state ?? "pre";
  return {
    id: String(c.id),
    league: league.id,
    leagueName: `${league.name} · ${e.name}`,
    sport: league.sport,
    kind: "match",
    title: `${a.name} vs ${h.name}`,
    date: c.date ?? e.date,
    state,
    status: [extra, c.status?.type?.shortDetail].filter(Boolean).join(" · "),
    venue: c.venue?.fullName ?? e.venue?.displayName ?? "",
    home: h,
    away: a,
    score: "",
    odds: NO_ODDS,
  };
}

function fieldEvent(league: League, e: any): Game {
  const comp = e.competitions?.find((c: any) => /race|carrera/i.test(c.type?.abbreviation ?? "")) ?? e.competitions?.[0] ?? {};
  const field = (comp.competitors ?? [])
    .slice()
    .sort((a: any, b: any) => (a.order ?? 999) - (b.order ?? 999))
    .map((c: any) => c.athlete?.displayName ?? c.team?.displayName)
    .filter(Boolean)
    .slice(0, 40);
  return {
    id: String(e.id),
    league: league.id,
    leagueName: league.name,
    sport: league.sport,
    kind: "field",
    title: e.name,
    date: comp.date ?? e.date,
    state: e.status?.type?.state ?? "pre",
    status: e.status?.type?.shortDetail ?? "",
    venue: comp.venue?.fullName ?? e.circuit?.fullName ?? "",
    home: EMPTY_SIDE,
    away: EMPTY_SIDE,
    field,
    score: "",
    odds: NO_ODDS,
  };
}

export async function fetchGames(leagueId: string, days = 7): Promise<Game[]> {
  const league = LEAGUES.find((l) => l.id === leagueId);
  if (!league) throw new Error("Liga desconocida");

  const base = `https://site.api.espn.com/apis/site/v2/sports/${league.path}/scoreboard`;
  // ESPN no acepta rangos de fechas: las ligas por jornada/evento usan la actual; el resto se pide día por día.
  const urls = league.weekly
    ? [base]
    : Array.from({ length: days + 1 }, (_, i) => `${base}?dates=${ymd(new Date(Date.now() + i * 86400000))}`);

  const pages = await Promise.all(
    urls.map(async (u) => {
      const res = await fetch(u, { next: { revalidate: 300 } });
      if (!res.ok) throw new Error(`ESPN respondió ${res.status}`);
      return res.json();
    }),
  );
  const seen = new Set<string>();
  const events: any[] = pages.flatMap((p: any) => p.events ?? []).filter((e: any) => !seen.has(e.id) && seen.add(e.id));

  let games: Game[];
  switch (league.format ?? "team") {
    case "fights":
      games = events.flatMap((e) =>
        (e.competitions ?? [])
          .filter((c: any) => c.competitors?.length === 2)
          .map((c: any) => bout(league, e, c, c.type?.abbreviation ?? "")),
      );
      break;
    case "tennis":
      games = events.flatMap((e) =>
        (e.groupings ?? [])
          .filter((g: any) => /singles/i.test(g.grouping?.slug ?? ""))
          .flatMap((g: any) =>
            (g.competitions ?? [])
              .filter((c: any) => c.competitors?.length === 2 && c.status?.type?.state !== "post")
              .map((c: any) => bout(league, e, c, [g.grouping?.displayName, c.round?.displayName].filter(Boolean).join(", "))),
          ),
      );
      break;
    case "field":
      games = events.map((e) => fieldEvent(league, e));
      break;
    default:
      games = events.map((e) => teamGame(league, e));
  }
  return games.sort((a, b) => a.date.localeCompare(b.date));
}

// Evento escrito por el usuario para deportes o mercados que ESPN no cubre.
export function manualGame(sport: Sport, evento: string, torneo: string, fecha: string, notas: string): Game {
  const parts = evento.split(/\s+(?:vs\.?|v\.?|contra|-)\s+/i);
  const isMatch = parts.length === 2;
  const mk = (name: string): TeamSide => ({ ...EMPTY_SIDE, name: name.trim() });
  return {
    id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    league: "manual",
    leagueName: torneo.trim() || sportInfo(sport).label,
    sport,
    kind: isMatch ? "match" : "field",
    title: evento.trim(),
    date: fecha ? new Date(fecha).toISOString() : new Date().toISOString(),
    state: "pre",
    status: "",
    venue: "",
    home: isMatch ? mk(parts[1]) : EMPTY_SIDE,
    away: isMatch ? mk(parts[0]) : EMPTY_SIDE,
    score: "",
    odds: NO_ODDS,
    manual: true,
    notes: notas.trim().slice(0, 500),
  };
}
