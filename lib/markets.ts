// Catálogo de mercados por deporte. El cliente manda solo ids; el servidor los traduce
// a texto con este catálogo, así no llega texto libre al prompt por aquí.
import type { Sport } from "./espn";

export interface Market {
  id: string;
  label: string;
  hint: string; // qué datos debe buscar la IA
}

export const MARKETS: Record<Sport, Market[]> = {
  americano: [
    { id: "ganador", label: "Ganador", hint: "moneyline" },
    { id: "handicap", label: "Hándicap", hint: "spread principal y alternos" },
    { id: "total", label: "Total de puntos", hint: "over/under del partido y alternos" },
    { id: "total_equipo", label: "Puntos por equipo", hint: "total de cada equipo" },
    { id: "mitades", label: "1.ª mitad / cuartos", hint: "ganador y total de la 1.ª mitad o 1.er cuarto" },
    { id: "pase", label: "Yardas de pase", hint: "QB: yardas, pases completos, TD de pase; defensa aérea rival" },
    { id: "carrera", label: "Yardas de carrera", hint: "RB/QB: yardas y acarreos; defensa terrestre rival" },
    { id: "recepcion", label: "Yardas y recepciones", hint: "WR/TE/RB: yardas, recepciones, targets" },
    { id: "td", label: "Anotador de TD", hint: "anotar en cualquier momento; uso en zona roja" },
    { id: "fg", label: "Goles de campo", hint: "FG del pateador (más/menos de X), puntos del pateador, % de acierto, clima/viento, eficiencia en zona roja de ambas ofensivas" },
    { id: "defensa", label: "Sacks e intercepciones", hint: "sacks, intercepciones y entregas de balón" },
  ],
  soccer: [
    { id: "resultado", label: "Resultado 1X2", hint: "local, empate o visitante" },
    { id: "doble", label: "Doble oportunidad", hint: "1X, X2, 12" },
    { id: "handicap", label: "Hándicap", hint: "asiático o europeo" },
    { id: "goles", label: "Total de goles", hint: "más/menos de 1.5, 2.5, 3.5; goles por equipo" },
    { id: "ambos", label: "Ambos anotan", hint: "sí/no" },
    { id: "corners", label: "Tiros de esquina", hint: "córners totales y por equipo (promedio a favor y en contra de cada uno, local/visitante)" },
    { id: "tarjetas", label: "Tarjetas", hint: "tarjetas totales y por equipo; promedio del árbitro designado" },
    { id: "faltas", label: "Faltas", hint: "faltas totales, por equipo y de jugador; estilo de juego y árbitro" },
    { id: "tiros", label: "Tiros y tiros a gol", hint: "tiros a gol por equipo y por jugador" },
    { id: "goleador", label: "Goleador", hint: "anota en cualquier momento; penales" },
    { id: "primer_tiempo", label: "1.er tiempo", hint: "resultado y goles del primer tiempo" },
  ],
  basquet: [
    { id: "ganador", label: "Ganador", hint: "moneyline" },
    { id: "handicap", label: "Hándicap", hint: "spread principal y alternos" },
    { id: "total", label: "Total de puntos", hint: "over/under del partido y alternos" },
    { id: "total_equipo", label: "Puntos por equipo", hint: "total de cada equipo" },
    { id: "mitades", label: "1.ª mitad / cuartos", hint: "ganador y total de la 1.ª mitad o 1.er cuarto" },
    { id: "puntos", label: "Puntos de jugador", hint: "promedio, minutos, uso; defensa rival por posición" },
    { id: "rebotes", label: "Rebotes", hint: "rebotes de jugador" },
    { id: "asistencias", label: "Asistencias", hint: "asistencias de jugador" },
    { id: "triples", label: "Triples", hint: "triples anotados de jugador" },
    { id: "pra", label: "Puntos+rebotes+asistencias", hint: "combinados PRA, PR, PA" },
    { id: "defensa", label: "Robos y bloqueos", hint: "robos y bloqueos de jugador" },
  ],
};


const M = (id: string, label: string, hint: string): Market => ({ id, label, hint });
const GANADOR = M("ganador", "Ganador", "quién gana, momio directo");
const HANDICAP = M("handicap", "Hándicap", "spread o hándicap principal y alternos");
const TOTAL = M("total", "Total", "más/menos del total principal y alternos");
const ESPECIALES = M("especiales", "Mercados especiales", "props y mercados especiales que ofrezcan las casas para este evento");

Object.assign(MARKETS, {
  beisbol: [GANADOR, M("runline", "Run line", "hándicap de carreras ±1.5"), M("total", "Total de carreras", "más/menos de carreras del partido"), M("total_equipo", "Carreras por equipo", "total de cada equipo"), M("cinco", "Primeras 5 entradas", "ganador y total de las primeras 5 entradas"), M("primera", "1.ª entrada", "¿hay carrera en la 1.ª entrada? (YRFI/NRFI)"), M("ponches", "Ponches del abridor", "ponches del pitcher abridor; tasa de ponches del rival"), M("hits", "Hits y bases totales", "hits, bases totales, carreras impulsadas de bateadores"), M("jonron", "Jonrón de jugador", "batea jonrón; poder contra el abridor rival")],
  hockey: [GANADOR, M("puckline", "Puck line", "hándicap ±1.5"), M("total", "Total de goles", "más/menos de goles"), M("total_equipo", "Goles por equipo", "total de cada equipo"), M("periodo", "1.er periodo", "ganador y goles del 1.er periodo"), M("goleador", "Goleador", "anota en cualquier momento"), M("tiros", "Tiros a gol de jugador", "tiros a gol de jugador"), M("puntos", "Puntos de jugador", "goles + asistencias"), M("portero", "Atajadas del portero", "atajadas del portero titular")],
  tenis: [GANADOR, M("handicap_games", "Hándicap de games", "hándicap de games del partido"), M("total_games", "Total de games", "más/menos de games"), M("sets", "Sets", "resultado exacto en sets, total de sets"), M("primer_set", "1.er set", "ganador del 1.er set"), M("aces", "Aces y dobles faltas", "aces y dobles faltas de cada jugador"), M("tiebreak", "Tie-break", "¿habrá tie-break?")],
  mma: [GANADOR, M("metodo", "Método de victoria", "KO/TKO, sumisión o decisión"), M("rounds", "Total de rounds", "más/menos de rounds"), M("decision", "¿Llega a la decisión?", "sí/no"), M("round_exacto", "Round de la victoria", "en qué round termina")],
  box: [GANADOR, M("metodo", "Método de victoria", "KO/TKO, decisión, descalificación"), M("rounds", "Total de rounds", "más/menos de rounds"), M("decision", "¿Llega a la decisión?", "sí/no"), M("round_exacto", "Round de la victoria", "en qué round termina")],
  motor: [GANADOR, M("podio", "Podio", "termina en el top 3"), M("top", "Top 6 / Top 10", "termina en el top 6 o top 10"), M("duelos", "Duelos entre pilotos", "quién termina más arriba entre dos pilotos"), M("pole", "Pole position", "clasificación"), M("vuelta", "Vuelta rápida", "vuelta más rápida"), M("constructor", "Mejor equipo", "equipo/constructor con mejor resultado")],
  golf: [GANADOR, M("top", "Top 5 / 10 / 20", "termina en el top 5, 10 o 20"), M("duelos", "Duelos", "quién termina más arriba entre dos golfistas"), M("corte", "Pasa el corte", "sí/no"), M("ronda", "Ronda", "mejor ronda, ronda más baja de un día"), M("nacionalidad", "Mejor por país", "mejor golfista de cierto país")],
  afl: [GANADOR, HANDICAP, M("total", "Total de puntos", "más/menos de puntos"), M("goles_jugador", "Goles de jugador", "goles de jugador"), M("disposals", "Disposals", "disposals de jugador"), M("margen", "Margen de victoria", "rangos de margen")],
  rugby: [GANADOR, HANDICAP, M("total", "Total de puntos", "más/menos de puntos"), M("try", "Anotador de try", "anota try en cualquier momento o primero"), M("tries", "Total de tries", "tries del partido o por equipo"), M("mitad", "1.ª mitad", "ganador y puntos del 1.er tiempo"), M("margen", "Margen de victoria", "rangos de margen")],
  voleibol: [GANADOR, M("handicap_sets", "Hándicap de sets", "hándicap de sets"), M("sets", "Total y marcador de sets", "3, 4 o 5 sets; marcador exacto"), M("puntos", "Total de puntos", "más/menos de puntos"), M("primer_set", "1.er set", "ganador del 1.er set")],
  lacrosse: [GANADOR, HANDICAP, M("total", "Total de goles", "más/menos de goles"), M("goleador", "Goles de jugador", "goles y puntos de jugador")],
  caballos: [GANADOR, M("colocado", "Colocado", "termina 2.º o 3.º (place/show)"), M("exacta", "Exacta / trifecta", "orden exacto de llegada"), M("duelos", "Duelos", "quién llega antes entre dos"), ESPECIALES],
  esports: [GANADOR, M("handicap_mapas", "Hándicap de mapas", "hándicap de mapas/rondas"), M("mapas", "Total de mapas", "más/menos de mapas"), M("primer_mapa", "1.er mapa", "ganador del 1.er mapa"), M("kills", "Kills / rondas", "total de kills o rondas"), ESPECIALES],
  dardos: [GANADOR, HANDICAP, M("total", "Total de sets/legs", "más/menos de sets o legs"), M("180s", "180s", "más/menos de 180s"), M("checkout", "Checkout más alto", "checkout más alto")],
  snooker: [GANADOR, HANDICAP, M("total", "Total de frames", "más/menos de frames"), M("centenas", "Centenas", "breaks de 100+"), M("marcador", "Marcador exacto", "frames exactos")],
  politica: [M("ganador", "Ganador de la elección", "quién gana; encuestas y mercados de predicción"), M("margen", "Margen / porcentaje", "porcentaje de voto o margen"), ESPECIALES],
  entretenimiento: [M("ganador", "Ganador", "premio, concurso o reality"), ESPECIALES],
});
MARKETS.rugby_league = MARKETS.rugby;
MARKETS.galgos = MARKETS.caballos;
MARKETS.futsal = MARKETS.soccer;

// Para los deportes sin catálogo propio.
export const GENERIC_MARKETS: Market[] = [GANADOR, HANDICAP, TOTAL, ESPECIALES];
export const marketsOf = (sport: Sport): Market[] => MARKETS[sport] ?? GENERIC_MARKETS;
export const defaultMarketsOf = (sport: Sport): string[] =>
  DEFAULT_MARKETS[sport] ?? marketsOf(sport).slice(0, 4).map((m) => m.id);

export const DEFAULT_MARKETS: Record<Sport, string[]> = {
  beisbol: ["ganador", "runline", "total", "ponches", "hits"],
  hockey: ["ganador", "puckline", "total", "goleador", "tiros"],
  tenis: ["ganador", "handicap_games", "total_games", "sets", "aces"],
  mma: ["ganador", "metodo", "rounds", "decision"],
  box: ["ganador", "metodo", "rounds", "decision"],
  motor: ["ganador", "podio", "top", "duelos"],
  golf: ["ganador", "top", "duelos", "corte"],
  americano: ["ganador", "handicap", "total", "pase", "carrera", "td"],
  soccer: ["resultado", "doble", "goles", "ambos", "corners", "tarjetas"],
  basquet: ["ganador", "handicap", "total", "puntos", "rebotes", "asistencias"],
};

export type MarketSelection = Partial<Record<Sport, string[]>>;

// Texto para el prompt con los mercados elegidos de un deporte; usa los de fábrica si no hay selección válida.
export function describeMarkets(sport: Sport, ids: string[] | undefined): { text: string; count: number; ids: string[] } {
  const all = marketsOf(sport);
  let chosen = Array.isArray(ids) ? all.filter((m) => ids.includes(m.id)) : [];
  if (chosen.length === 0) chosen = all.filter((m) => defaultMarketsOf(sport).includes(m.id));
  return { text: chosen.map((m) => `${m.label} (${m.hint})`).join("; "), count: chosen.length, ids: chosen.map((m) => m.id) };
}

// Mercados que no piden búsquedas propias; el resto (córners, props…) encarece el análisis.
export const BASIC_MARKETS = new Set(["ganador", "handicap", "total", "resultado", "doble", "goles", "ambos"]);

/** Análisis extendido: más de 3 mercados de estadísticas (cuesta créditos extra). */
export const isExtended = (ids: string[]) => ids.filter((id) => !BASIC_MARKETS.has(id)).length > 3;
