// Arma parlays a partir de las opciones por partido. Matemática pura, sin IA.
// Entre partidos distintos la probabilidad se multiplica (son independientes). Dentro del mismo
// partido no: las combinadas traen su probabilidad conjunta ya calculada por la IA.

export interface LegOption {
  mercado: string;
  seleccion: string;
  probabilidad: number; // 0-100
  cuota: string; // momio americano
  cuota_estimada: boolean;
  razon: string;
}

export interface SameGameCombo {
  selecciones: { mercado: string; seleccion: string }[];
  probabilidad: number; // conjunta, 0-100
  cuota: string;
  cuota_estimada: boolean;
  razon: string;
}

export interface GameOptions {
  id: string;
  partido: string;
  opciones: LegOption[];
  combinadas?: SameGameCombo[];
}

// Lo que aporta un partido al parlay: una apuesta suelta o una combinada del mismo partido.
export interface Leg {
  gameId: string;
  partido: string;
  selecciones: { mercado: string; seleccion: string }[];
  probabilidad: number;
  cuota: string;
  cuota_estimada: boolean;
  razon: string;
}

export interface Parlay {
  tipo: "Segura" | "Valor";
  piernas: Leg[];
  apuestas: number; // total de selecciones
  partidos: number;
  probabilidad: number; // 0-100, con decimales
  cuotaDecimal: number | null;
  cuotaAmericana: string;
  pagoPor100: number | null; // pago total por apostar 100
  valorEsperado: number | null; // ganancia esperada por cada 100 apostados
  cuotaEstimada: boolean;
}

export const MAX_APUESTAS = 20;

// Tamaño máximo de las combinadas del mismo partido: con pocos partidos hacen falta combinadas
// más grandes para llegar a la cantidad de apuestas pedida (con 1 partido, todo sale de ahí).
export function comboMaxSize(nGames: number, maxLegs: number) {
  return Math.max(3, Math.min(8, Math.ceil(maxLegs / Math.max(1, nGames))));
}

export function americanToDecimal(s: string): number | null {
  const m = s.replace(/,/g, "").match(/[+-]?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  if (!Number.isFinite(n)) return null;
  if (n >= 100) return 1 + n / 100;
  if (n <= -100) return 1 + 100 / -n;
  if (n > 1 && n < 30) return n; // ya viene en formato decimal (1.85)
  return null;
}

export function decimalToAmerican(d: number): string {
  if (d >= 2) return `+${Math.round((d - 1) * 100)}`;
  return `-${Math.round(100 / (d - 1))}`;
}

function makeParlay(tipo: Parlay["tipo"], piernas: Leg[]): Parlay {
  const p = piernas.reduce((acc, l) => acc * (l.probabilidad / 100), 1);
  const decs = piernas.map((l) => americanToDecimal(l.cuota));
  const dec = decs.every((d) => d != null) ? decs.reduce((a, d) => a * (d as number), 1) : null;
  return {
    tipo,
    piernas,
    apuestas: piernas.reduce((n, l) => n + l.selecciones.length, 0),
    partidos: piernas.length,
    probabilidad: Math.round(p * 10000) / 100,
    cuotaDecimal: dec == null ? null : Math.round(dec * 100) / 100,
    cuotaAmericana: dec == null ? "" : decimalToAmerican(dec),
    pagoPor100: dec == null ? null : Math.round(dec * 100),
    valorEsperado: dec == null ? null : Math.round((p * dec - 1) * 100),
    cuotaEstimada: piernas.some((l) => l.cuota_estimada),
  };
}

function legsOf(g: GameOptions, sameGame: boolean): Leg[] {
  const singles: Leg[] = g.opciones.map((o) => ({
    gameId: g.id,
    partido: g.partido,
    selecciones: [{ mercado: o.mercado, seleccion: o.seleccion }],
    probabilidad: o.probabilidad,
    cuota: o.cuota,
    cuota_estimada: o.cuota_estimada,
    razon: o.razon,
  }));
  if (!sameGame) return singles;
  const combos: Leg[] = (g.combinadas ?? []).map((c) => ({ gameId: g.id, partido: g.partido, ...c }));
  return [...singles, ...combos];
}

// Para cada cantidad de apuestas k, elige a lo más una pierna por partido maximizando el puntaje
// (suma de logaritmos = producto). Mochila exacta: con 20 partidos y k ≤ 20 es instantáneo.
function best(games: Leg[][], score: (l: Leg) => number | null): (Leg[] | null)[] {
  type Cell = { s: number; legs: Leg[] } | null;
  let dp: Cell[] = Array.from({ length: MAX_APUESTAS + 1 }, (_, i) => (i === 0 ? { s: 0, legs: [] } : null));
  for (const legs of games) {
    const next = [...dp];
    for (let j = 0; j <= MAX_APUESTAS; j++) {
      const cur = dp[j];
      if (!cur) continue;
      for (const l of legs) {
        const v = score(l);
        const k = j + l.selecciones.length;
        if (v == null || v <= 0 || k > MAX_APUESTAS) continue;
        const s = cur.s + Math.log(v);
        if (!next[k] || s > next[k]!.s) next[k] = { s, legs: [...cur.legs, l] };
      }
    }
    dp = next;
  }
  return dp.map((c) => c?.legs ?? null);
}

const legKey = (l: Leg) => `${l.gameId}:${l.selecciones.map((s) => s.seleccion).join("+")}`;
const key = (legs: Leg[]) => legs.map(legKey).sort().join("|");

// Cada vez que una apuesta ya salió en otro parlay, su puntaje se multiplica por esto. Así los
// parlays se arman con selecciones distintas y una sola apuesta fallida no tumba a todos.
const REPETIDA = 0.7;

export function buildParlays(games: GameOptions[], minLegs: number, maxLegs: number, sameGame = false): Parlay[] {
  const perGame = games.map((g) => legsOf(g, sameGame)).filter((l) => l.length > 0);
  const usos = new Map<string, number>();
  const castigo = (l: Leg) => REPETIDA ** (usos.get(legKey(l)) ?? 0);
  const segura = (l: Leg) => (l.probabilidad / 100) * castigo(l);
  const valor = (l: Leg) => {
    const d = americanToDecimal(l.cuota);
    return d == null ? null : (l.probabilidad / 100) * d * castigo(l);
  };
  const usar = (legs: Leg[]) => legs.forEach((l) => usos.set(legKey(l), (usos.get(legKey(l)) ?? 0) + 1));

  const lo = Math.max(2, Math.min(minLegs, maxLegs));
  const hi = Math.min(Math.max(minLegs, maxLegs), MAX_APUESTAS);
  const out: Parlay[] = [];
  const vistos = new Set<string>();
  for (let k = lo; k <= hi; k++) {
    for (const [tipo, score] of [["Segura", segura], ["Valor", valor]] as const) {
      const legs = best(perGame, score)[k];
      if (!legs?.length || vistos.has(key(legs))) continue;
      vistos.add(key(legs));
      out.push(makeParlay(tipo, legs));
      usar(legs);
    }
  }
  return out;
}

/** Identidad de una pierna (para enlazarla con su pick). */
export function legKeyOf(l: Leg) {
  return legKey(l);
}
