// Partidos próximos y momios desde la API pública de ESPN (sin llave).

export type Sport = "americano" | "soccer" | "basquet";

export interface League {
  id: string;
  sport: Sport;
  name: string;
  path: string; // deporte/liga en la URL de ESPN
  weekly?: boolean; // la NFL ya devuelve la semana actual sin fechas
}

export const LEAGUES: League[] = [
  { id: "nfl", sport: "americano", name: "NFL", path: "football/nfl", weekly: true },
  { id: "ncaaf", sport: "americano", name: "NCAA Football", path: "football/college-football", weekly: true },
  { id: "nba", sport: "basquet", name: "NBA", path: "basketball/nba" },
  { id: "wnba", sport: "basquet", name: "WNBA", path: "basketball/wnba" },
  { id: "ncaab", sport: "basquet", name: "NCAA Basketball", path: "basketball/mens-college-basketball" },
  { id: "mex.1", sport: "soccer", name: "Liga MX", path: "soccer/mex.1" },
  { id: "eng.1", sport: "soccer", name: "Premier League", path: "soccer/eng.1" },
  { id: "esp.1", sport: "soccer", name: "LaLiga", path: "soccer/esp.1" },
  { id: "ita.1", sport: "soccer", name: "Serie A", path: "soccer/ita.1" },
  { id: "ger.1", sport: "soccer", name: "Bundesliga", path: "soccer/ger.1" },
  { id: "uefa.champions", sport: "soccer", name: "Champions League", path: "soccer/uefa.champions" },
  { id: "usa.1", sport: "soccer", name: "MLS", path: "soccer/usa.1" },
];

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
  date: string;
  state: "pre" | "in" | "post";
  status: string;
  venue: string;
  home: TeamSide;
  away: TeamSide;
  score: string;
  odds: { provider: string; details: string; overUnder: number | null; draw: string };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function side(c: any, ml: any): TeamSide {
  return {
    name: c?.team?.displayName ?? "?",
    abbr: c?.team?.abbreviation ?? "",
    logo: c?.team?.logo ?? "",
    record: c?.records?.[0]?.summary ?? "",
    form: c?.form ?? "",
    moneyline: ml?.close?.odds ?? ml?.open?.odds ?? "",
  };
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export async function fetchGames(leagueId: string, days = 7): Promise<Game[]> {
  const league = LEAGUES.find((l) => l.id === leagueId);
  if (!league) throw new Error("Liga desconocida");

  const base = `https://site.api.espn.com/apis/site/v2/sports/${league.path}/scoreboard`;
  // ESPN no acepta rangos de fechas: la NFL trae su semana; el resto se pide día por día.
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
  const events = pages.flatMap((p: any) => p.events ?? []).filter((e: any) => !seen.has(e.id) && seen.add(e.id));

  return events
    .sort((a: any, b: any) => a.date.localeCompare(b.date))
    .map((e: any): Game => {
    const comp = e.competitions?.[0] ?? {};
    const odds = comp.odds?.[0] ?? {};
    const home = comp.competitors?.find((c: any) => c.homeAway === "home");
    const away = comp.competitors?.find((c: any) => c.homeAway === "away");
    const state = e.status?.type?.state ?? "pre";
    return {
      id: String(e.id),
      league: league.id,
      leagueName: league.name,
      sport: league.sport,
      date: e.date,
      state,
      status: e.status?.type?.shortDetail ?? "",
      venue: comp.venue?.fullName ?? "",
      home: side(home, odds.moneyline?.home),
      away: side(away, odds.moneyline?.away),
      score: state === "pre" ? "" : `${away?.score ?? ""} - ${home?.score ?? ""}`,
      odds: {
        provider: odds.provider?.displayName ?? odds.provider?.name ?? "",
        details: odds.details ?? "",
        overUnder: typeof odds.overUnder === "number" ? odds.overUnder : null,
        draw: odds.moneyline?.draw?.close?.odds ?? odds.drawOdds?.moneyLine?.toString() ?? "",
      },
    };
  });
}
