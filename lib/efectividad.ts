// Estadísticas de la sección pública de efectividad (se calculan en el servidor).
import { americanToDecimal } from "./parlay";

export type Status = "pendiente" | "ganada" | "perdida" | "push" | "anulada";

export interface PickPublic {
  id: string;
  sport: string;
  league_name: string;
  title: string;
  game_date: string;
  mercado: string;
  seleccion: string;
  probabilidad: number;
  cuota: string | null;
  cuota_estimada: boolean;
  status: Status;
  resultado: string | null;
  graded_by: string | null;
  origen: string;
}

export interface Group {
  key: string;
  decididas: number;
  ganadas: number;
  acierto: number | null; // % real
  esperado: number | null; // % que dijo la IA en promedio
}

export interface Stats {
  total: number;
  ganadas: number;
  perdidas: number;
  push: number;
  anuladas: number;
  pendientes: number;
  acierto: number | null;
  esperado: number | null;
  roi: number | null; // % de ganancia apostando lo mismo a cada pick con momio
  conMomio: number;
  calibracion: (Group & { desde: number; hasta: number })[];
  porDeporte: Group[];
  porMercado: Group[];
}

// Agrupa el texto libre del mercado en categorías legibles (el orden importa: la primera que coincide gana).
const CATEGORIAS: [RegExp, string][] = [
  [/combinada/i, "Combinadas mismo partido"],
  [/c[oó]rner|esquina/i, "Córners"],
  [/tarjeta|amarilla|roja/i, "Tarjetas"],
  [/falta/i, "Faltas"],
  [/gol(es)? de campo|field goal|\bfg\b|pateador/i, "Goles de campo"],
  [/doble oportunidad/i, "Doble oportunidad"],
  [/ambos anotan/i, "Ambos anotan"],
  [/yardas|pase|recepci|acarreo|touchdown|\btd\b|anotador/i, "Props NFL"],
  [/puntos de|rebote|asistencia|triple|\bpra\b/i, "Props NBA"],
  [/goleador|anota|tiros/i, "Goleador y tiros"],
  [/ponche|\bhits?\b|jonr[oó]n|bases/i, "Props béisbol"],
  [/h[aá]ndicap|spread|run line|puck line/i, "Hándicap"],
  [/total|m[aá]s de|menos de|over|under|goles/i, "Totales"],
  [/ganador|resultado|gana|moneyline|1x2/i, "Ganador"],
];
export const categoria = (mercado: string) => CATEGORIAS.find(([re]) => re.test(mercado))?.[1] ?? "Otros";

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);

function group(key: string, picks: PickPublic[]): Group {
  const dec = picks.filter((p) => p.status === "ganada" || p.status === "perdida");
  const g = dec.filter((p) => p.status === "ganada").length;
  return {
    key,
    decididas: dec.length,
    ganadas: g,
    acierto: pct(g, dec.length),
    esperado: dec.length ? Math.round((dec.reduce((n, p) => n + p.probabilidad, 0) / dec.length) * 10) / 10 : null,
  };
}

function groupBy(picks: PickPublic[], f: (p: PickPublic) => string): Group[] {
  const m = new Map<string, PickPublic[]>();
  for (const p of picks) {
    const k = f(p);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(p);
  }
  return [...m]
    .map(([k, v]) => group(k, v))
    .filter((g) => g.decididas > 0)
    .sort((a, b) => b.decididas - a.decididas);
}

export function computeStats(picks: PickPublic[]): Stats {
  const count = (s: Status) => picks.filter((p) => p.status === s).length;
  const all = group("todo", picks);

  // ROI: apostar 1 a cada pick decidido que tenga momio (push devuelve lo apostado).
  let profit = 0;
  let conMomio = 0;
  for (const p of picks) {
    if (p.status !== "ganada" && p.status !== "perdida" && p.status !== "push") continue;
    const d = americanToDecimal(p.cuota ?? "");
    if (d == null) continue;
    conMomio++;
    profit += p.status === "ganada" ? d - 1 : p.status === "perdida" ? -1 : 0;
  }

  const tramos: [number, number][] = [
    [1, 39],
    [40, 49],
    [50, 59],
    [60, 69],
    [70, 79],
    [80, 99],
  ];
  return {
    total: picks.length,
    ganadas: count("ganada"),
    perdidas: count("perdida"),
    push: count("push"),
    anuladas: count("anulada"),
    pendientes: count("pendiente"),
    acierto: all.acierto,
    esperado: all.esperado,
    roi: conMomio ? Math.round((profit / conMomio) * 1000) / 10 : null,
    conMomio,
    calibracion: tramos.map(([desde, hasta]) => ({
      desde,
      hasta,
      ...group(`${desde}-${hasta}%`, picks.filter((p) => p.probabilidad >= desde && p.probabilidad <= hasta)),
    })),
    porDeporte: groupBy(picks, (p) => p.sport),
    porMercado: groupBy(picks, (p) => categoria(p.mercado)),
  };
}
