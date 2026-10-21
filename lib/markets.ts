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

export const DEFAULT_MARKETS: Record<Sport, string[]> = {
  americano: ["ganador", "handicap", "total", "pase", "carrera", "td"],
  soccer: ["resultado", "doble", "goles", "ambos", "corners", "tarjetas"],
  basquet: ["ganador", "handicap", "total", "puntos", "rebotes", "asistencias"],
};

export type MarketSelection = Partial<Record<Sport, string[]>>;

// Texto para el prompt con los mercados elegidos de un deporte; usa los de fábrica si no hay selección válida.
export function describeMarkets(sport: Sport, ids: string[] | undefined): { text: string; count: number; ids: string[] } {
  const all = MARKETS[sport] ?? [];
  let chosen = Array.isArray(ids) ? all.filter((m) => ids.includes(m.id)) : [];
  if (chosen.length === 0) chosen = all.filter((m) => DEFAULT_MARKETS[sport].includes(m.id));
  return { text: chosen.map((m) => `${m.label} (${m.hint})`).join("; "), count: chosen.length, ids: chosen.map((m) => m.id) };
}
