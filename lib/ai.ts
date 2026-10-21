import Anthropic from "@anthropic-ai/sdk";
import type { Game } from "./espn";
import type { GameOptions } from "./parlay";

const client = new Anthropic();
const MODEL = "claude-opus-5-5";

type Effort = "low" | "medium" | "high";
const EFFORT: Effort = (["low", "medium", "high"] as const).includes(process.env.AI_EFFORT as Effort)
  ? (process.env.AI_EFFORT as Effort)
  : "medium";

export interface Pick {
  mercado: string;
  seleccion: string;
  probabilidad: number;
  cuota: string;
  probabilidad_implicita: number | null;
  valor: "a favor" | "en contra" | "neutral" | "sin cuota";
  confianza: "baja" | "media" | "alta";
  razones: string[];
}

export interface Analysis {
  titulo: string;
  resumen: string;
  picks: Pick[];
  datos_clave: string[];
  advertencias: string[];
  fuentes: { title: string; url: string }[];
  modelo: string;
}

export interface AnalyzeInput {
  image?: string; // JPEG en base64 sin prefijo data:
  game?: Game;
  question?: string;
}

// Fijo para que se pueda cachear; lo variable (fecha, partido, captura) va en el mensaje.
const SYSTEM = `Eres un analista de apuestas deportivas (NFL, fútbol soccer y básquetbol) que da pronósticos en español de México.

Cómo trabajas:
1. Identifica qué se te pide: un partido (ganador, hándicap, total de puntos/goles) o el desempeño de un jugador (yardas, puntos, rebotes, goles, tiros, etc.). Si recibes una captura de pantalla de una casa de apuestas o quiniela, lee los partidos, mercados, líneas y momios que se vean y analiza esos. Si hay muchos, elige los 6 más claros; en una quiniela da un pronóstico por partido.
2. Busca en la web datos ACTUALES antes de opinar: lesionados y reportes de estado, forma reciente (últimos 5 partidos), estadísticas ofensivas y defensivas de la temporada y su lugar en la liga, enfrentamiento directo, local/visitante, descanso y viajes, clima si es al aire libre. Para jugadores: promedio de la temporada y de los últimos 3-5 juegos, rango (mínimo y máximo), uso/minutos/snaps, y qué permite la defensa rival en esa estadística.
3. Calcula la probabilidad con honestidad:
   - Si hay momio, conviértelo a probabilidad implícita y quítale el margen de la casa; ese es tu punto de partida, porque el mercado ya contiene mucha información.
   - Muévete de ahí solo con evidencia concreta y explica cada ajuste. Un desvío de más de 8 puntos respecto al mercado necesita una razón fuerte (lesión clave no descontada, etc.).
   - En props de jugador compara la línea con su promedio y su variación; un promedio ligeramente arriba de la línea NO da 80%.
   - No pases de 85% salvo casos extremos. Los deportes tienen mucha varianza; 55-65% ya es una ventaja real.
   - "valor" es "a favor" solo si tu probabilidad supera la implícita del momio por 3 puntos o más; "en contra" si queda 3 o más por debajo.
4. Las razones deben ser concretas y con números (ej. "Promedia 251 yardas, pero Green Bay permite 178 por partido, 2.º mejor de la liga"). Nada de frases genéricas.
5. Si no encuentras un dato, dilo. Nunca inventes estadísticas ni lesiones.

Al terminar, escribe un resumen breve y luego el resultado EXACTAMENTE en este formato, entre etiquetas <json> y </json>, JSON válido sin comentarios:
<json>
{
  "titulo": "Dallas vs Green Bay",
  "resumen": "2-3 frases con la conclusión",
  "picks": [
    {
      "mercado": "Ganador del partido" ,
      "seleccion": "Green Bay",
      "probabilidad": 60,
      "cuota": "-150 (o vacío si no hay)",
      "probabilidad_implicita": 58,
      "valor": "a favor | en contra | neutral | sin cuota",
      "confianza": "baja | media | alta",
      "razones": ["razón con datos", "..."]
    }
  ],
  "datos_clave": ["dato relevante", "..."],
  "advertencias": ["riesgo o dato faltante", "..."]
}
</json>
"probabilidad" y "probabilidad_implicita" son números de 0 a 100 (null si no hay momio).`;

function describeGame(g: Game) {
  const lines = [
    `Partido: ${g.away.name} (visitante, récord ${g.away.record || "?"}${g.away.form ? `, forma ${g.away.form}` : ""}) en ${g.home.name} (local, récord ${g.home.record || "?"}${g.home.form ? `, forma ${g.home.form}` : ""})`,
    `Liga: ${g.leagueName}. Fecha: ${g.date}. Estadio: ${g.venue || "?"}.`,
  ];
  const o = g.odds;
  const odds = [
    o.details && `línea ${o.details}`,
    o.overUnder != null && `total ${o.overUnder}`,
    g.away.moneyline && `momio ${g.away.abbr || g.away.name} ${g.away.moneyline}`,
    g.home.moneyline && `momio ${g.home.abbr || g.home.name} ${g.home.moneyline}`,
    o.draw && `empate ${o.draw}`,
  ].filter(Boolean);
  if (odds.length) lines.push(`Momios${o.provider ? ` (${o.provider})` : ""}: ${odds.join(", ")}.`);
  return lines.join("\n");
}

function extractJson<T>(text: string): T | null {
  const m = text.match(/<json>([\s\S]*?)<\/json>/) ?? text.match(/```json\s*([\s\S]*?)```/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function clampPct(n: unknown): number {
  const x = Number(n);
  return Number.isFinite(x) ? Math.max(1, Math.min(99, Math.round(x))) : 50;
}

export async function analyze(input: AnalyzeInput): Promise<Analysis> {
  const today = new Date().toLocaleString("es-MX", { dateStyle: "full", timeStyle: "short", timeZone: "America/Mexico_City" });
  const parts: string[] = [`Hoy es ${today} (hora del centro de México).`];
  if (input.game) parts.push(describeGame(input.game));
  if (input.image) parts.push("Adjunto una captura de la pantalla que estoy viendo (casa de apuestas o quiniela). Analiza lo que aparece en ella.");
  if (input.question?.trim()) parts.push(`Lo que quiero saber: ${input.question.trim()}`);
  else if (input.game) parts.push("Dame el pronóstico del ganador, el total de puntos/goles y, si hay jugadores destacados, 1-2 props de jugador interesantes.");

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (input.image) {
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: input.image } });
  }
  content.push({ type: "text", text: parts.join("\n\n") });

  const { text, fuentes, model } = await runClaude(SYSTEM, content, 8);

  const parsed = extractJson<Omit<Analysis, "fuentes" | "modelo">>(text);
  if (!parsed) {
    return {
      titulo: input.game ? `${input.game.away.name} vs ${input.game.home.name}` : "Análisis",
      resumen: text.replace(/<json>[\s\S]*$/, "").trim() || "La IA no devolvió un resultado legible. Intenta de nuevo.",
      picks: [],
      datos_clave: [],
      advertencias: ["No se pudo leer el formato del resultado."],
      fuentes,
      modelo: model,
    };
  }

  return {
    titulo: parsed.titulo ?? "Análisis",
    resumen: parsed.resumen ?? "",
    picks: (parsed.picks ?? []).map((p) => ({
      mercado: String(p.mercado ?? ""),
      seleccion: String(p.seleccion ?? ""),
      probabilidad: clampPct(p.probabilidad),
      cuota: String(p.cuota ?? ""),
      probabilidad_implicita: p.probabilidad_implicita == null ? null : clampPct(p.probabilidad_implicita),
      valor: p.valor ?? "sin cuota",
      confianza: p.confianza ?? "baja",
      razones: Array.isArray(p.razones) ? p.razones.map(String) : [],
    })),
    datos_clave: parsed.datos_clave ?? [],
    advertencias: parsed.advertencias ?? [],
    fuentes: fuentes.slice(0, 12),
    modelo: model,
  };
}

async function runClaude(system: string, content: Anthropic.Beta.BetaContentBlockParam[], maxSearches: number) {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content }];
  let final: Anthropic.Beta.BetaMessage | null = null;

  // pause_turn: la búsqueda web llegó a su límite de iteraciones; se reanuda con el turno parcial.
  for (let i = 0; i < 4; i++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: EFFORT },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: maxSearches }],
      messages,
    });
    final = await stream.finalMessage();
    if (final.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: final.content });
  }

  if (!final) throw new Error("Sin respuesta de la IA");
  if (final.stop_reason === "refusal") throw new Error("La IA no pudo analizar esta solicitud.");

  let text = "";
  const fuentes = new Map<string, string>();
  const consultadas = new Map<string, string>();
  for (const msg of [...messages.slice(1), { content: final.content }]) {
    for (const block of msg.content as Anthropic.Beta.BetaContentBlock[]) {
      if (block.type === "text") {
        if (msg.content === final.content) text += block.text;
        for (const c of block.citations ?? []) {
          if (c.type === "web_search_result_location" && !fuentes.has(c.url)) fuentes.set(c.url, c.title ?? c.url);
        }
      } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) if (!consultadas.has(r.url)) consultadas.set(r.url, r.title || r.url);
      }
    }
  }
  // Primero lo que la IA citó; si no citó nada, las páginas que encontró al buscar.
  const lista = fuentes.size ? fuentes : consultadas;
  return { text, fuentes: [...lista].map(([url, title]) => ({ url, title })), model: final.model };
}

// ---------- Parlay ----------

const PARLAY_SYSTEM = `Eres un analista de apuestas deportivas (NFL, fútbol soccer y básquetbol) que ayuda a armar parlays, en español de México.

Recibes una lista de partidos (cada uno con su id). Para CADA partido:
1. Busca en la web datos ACTUALES: lesionados, forma reciente, estadísticas ofensivas y defensivas, local/visitante, descanso, clima si aplica, y los números de los jugadores clave (promedio de la temporada y de los últimos juegos, y qué permite el rival en esa estadística).
2. "opciones": de 3 a 5 apuestas sueltas de distinto riesgo. Incluye siempre la MÁS PROBABLE (favorito, doble oportunidad en soccer, hándicap o total alterno), alguna con mejor pago (ganador, hándicap o total principal) y 1-2 props de jugador cuando tengas datos (NFL: yardas de pase/carrera/recepción, anotación; NBA: puntos, rebotes, asistencias; soccer: goleador, tiros a gol).
3. "combinadas": 1 o 2 combinaciones del MISMO partido (same game parlay) de 2 o 3 selecciones. Reglas:
   - Cada selección de un mercado distinto. Nada redundante ni contradictorio: no juntes "X gana" con un hándicap de X, dos líneas del mismo total, ni dos props del mismo jugador y la misma estadística. Usa combinaciones que las casas sí aceptan, como "Cowboys ganan + Dak Prescott más de 224.5 yardas de pase" o "Más de 2.5 goles + Ambos anotan: Sí".
   - "probabilidad" es la probabilidad de que se cumplan TODAS juntas, considerando que están relacionadas. Si se ayudan entre sí (el equipo gana y su QB lanza mucho), la conjunta es MAYOR que multiplicarlas; si se estorban, es MENOR. No las multipliques sin más.
   - "cuota" es el momio americano aproximado que pagaría la casa por esa combinada.
4. Calcula las probabilidades con honestidad: parte del momio de la casa sin margen y muévete solo con evidencia concreta; ninguna suelta pasa de 90%. Nunca inventes estadísticas ni lesiones.
5. "seleccion" debe entenderse sola, sin leer el mercado (ej. "Ambos anotan: Sí", "Bears ganan", "Dak Prescott más de 224.5 yardas de pase").
6. "cuota" es el momio americano (ej. "-150", "+120"). Si viene en los datos o lo encontraste, pon "cuota_estimada": false. Si no lo sabes con exactitud, pon el momio típico del mercado y "cuota_estimada": true.

Sé breve en el texto. Al final escribe EXACTAMENTE este formato entre <json> y </json>, JSON válido sin comentarios:
<json>
{
  "juegos": [
    {
      "id": "id del partido tal como te lo di",
      "partido": "Cowboys vs Packers",
      "opciones": [
        { "mercado": "Ganador", "seleccion": "Packers ganan", "probabilidad": 60, "cuota": "-160", "cuota_estimada": false, "razon": "una frase con datos" }
      ],
      "combinadas": [
        {
          "selecciones": [
            { "mercado": "Ganador", "seleccion": "Packers ganan" },
            { "mercado": "Yardas de pase", "seleccion": "Jordan Love más de 229.5 yardas de pase" }
          ],
          "probabilidad": 41,
          "cuota": "+190",
          "razon": "una frase con datos y por qué se relacionan"
        }
      ]
    }
  ],
  "advertencias": ["dato faltante o riesgo", "..."]
}
</json>
"probabilidad" es un número de 0 a 100.`;

export async function analyzeParlayGames(games: Game[]) {
  const today = new Date().toLocaleString("es-MX", { dateStyle: "full", timeStyle: "short", timeZone: "America/Mexico_City" });
  const text = [
    `Hoy es ${today} (hora del centro de México).`,
    ...games.map((g, i) => `### Partido ${i + 1} (id: ${g.id})\n${describeGame(g)}`),
  ].join("\n\n");

  // Unas dos búsquedas por partido (los props de jugadores piden más datos), con tope.
  const res = await runClaude(PARLAY_SYSTEM, [{ type: "text", text }], Math.min(32, games.length * 2 + 2));
  const parsed = extractJson<{ juegos?: GameOptions[]; advertencias?: string[] }>(res.text);
  if (!parsed?.juegos?.length) throw new Error("La IA no devolvió opciones legibles. Intenta de nuevo.");

  const juegos: GameOptions[] = parsed.juegos.map((j) => ({
    id: String(j.id ?? ""),
    partido: String(j.partido ?? ""),
    opciones: (j.opciones ?? []).map((o) => ({
      mercado: String(o.mercado ?? ""),
      seleccion: String(o.seleccion ?? ""),
      probabilidad: clampPct(o.probabilidad),
      cuota: String(o.cuota ?? ""),
      cuota_estimada: o.cuota_estimada !== false,
      razon: String(o.razon ?? ""),
    })),
    combinadas: (j.combinadas ?? [])
      .filter((c) => Array.isArray(c.selecciones) && c.selecciones.length >= 2)
      .map((c) => ({
        selecciones: c.selecciones.map((x) => ({ mercado: String(x?.mercado ?? ""), seleccion: String(x?.seleccion ?? "") })),
        probabilidad: clampPct(c.probabilidad),
        cuota: String(c.cuota ?? ""),
        cuota_estimada: true, // las casas ajustan el momio de las combinadas del mismo partido
        razon: String(c.razon ?? ""),
      })),
  }));
  return { juegos, advertencias: parsed.advertencias ?? [], fuentes: res.fuentes.slice(0, 15), modelo: res.model };
}
