import Anthropic from "@anthropic-ai/sdk";
import { sportInfo, type Game } from "./espn";
import { comboMaxSize, type GameOptions } from "./parlay";
import { BASIC_MARKETS, describeMarkets, type MarketSelection } from "./markets";
import { pool, recentForm } from "./stats";

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
  // Lo agrega la ruta de API:
  cache?: CacheInfo;
  restantes?: number | null; // créditos que le quedan; null = sin límite (admin)
  costo_usd?: number; // costo real de la IA (solo servidor, no se manda al cliente)
}

export interface CacheInfo {
  hit: boolean; // true si salió del caché compartido
  creado: string; // cuándo lo analizó la IA
  nuevos?: number; // parlay: partidos analizados ahora
  deCache?: number; // parlay: partidos que salieron del caché
}

export interface AnalyzeInput {
  image?: string; // JPEG en base64 sin prefijo data:
  game?: Game;
  question?: string;
  mercados?: MarketSelection;
}

// Fijo para que se pueda cachear; lo variable (fecha, partido, captura) va en el mensaje.
const SYSTEM = `Eres un analista de apuestas de cualquier deporte o evento (fútbol, NFL, béisbol, básquet, tenis, hockey, UFC, box, automovilismo, golf, rugby, eSports, caballos, política, etc.) que da pronósticos en español de México.

Cómo trabajas:
1. Identifica qué se te pide: un partido (ganador, hándicap, total de puntos/goles) o el desempeño de un jugador (yardas, puntos, rebotes, goles, tiros, etc.). Si recibes una captura de pantalla de una casa de apuestas o quiniela, lee los partidos, mercados, líneas y momios que se vean y analiza esos. Si hay muchos, elige los 6 más claros; en una quiniela da un pronóstico por partido. Si te dan una lista de mercados, da un pick por cada mercado de la lista donde encuentres datos suficientes (hasta 10 picks) y di en advertencias cuáles no pudiste analizar.
2. Busca en la web datos ACTUALES antes de opinar: lesionados y reportes de estado, forma reciente (últimos 5 partidos), estadísticas ofensivas y defensivas de la temporada y su lugar en la liga, enfrentamiento directo, local/visitante, descanso y viajes, clima si es al aire libre. Para mercados de equipo como córners, tarjetas, faltas, tiros o goles de campo: promedios a favor y en contra de cada equipo (local/visitante), tendencia reciente y, en tarjetas y faltas, el promedio del árbitro designado. Esos datos están en sitios de estadísticas como FootyStats, FBref, SoccerStats, WhoScored, Flashscore, TeamRankings o Pro Football Reference: busca algo como "Ipswich corners per game 2025/26" y abre la página con web_fetch para leer la tabla; no te rindas con una sola búsqueda. Reparte tus búsquedas entre todos los mercados pedidos. Para jugadores: promedio de la temporada y de los últimos 3-5 juegos, rango (mínimo y máximo), uso/minutos/snaps, y qué permite la defensa rival en esa estadística.
3. Calcula la probabilidad con honestidad:
   - Si hay momio, conviértelo a probabilidad implícita y quítale el margen de la casa; ese es tu punto de partida, porque el mercado ya contiene mucha información.
   - Muévete de ahí solo con evidencia concreta y explica cada ajuste. Un desvío de más de 8 puntos respecto al mercado necesita una razón fuerte (lesión clave no descontada, etc.).
   - En props de jugador compara la línea con su promedio y su variación; un promedio ligeramente arriba de la línea NO da 80%.
   - No pases de 85% salvo casos extremos. Los deportes tienen mucha varianza; 55-65% ya es una ventaja real.
   - "valor" es "a favor" solo si tu probabilidad supera la implícita del momio por 3 puntos o más; "en contra" si queda 3 o más por debajo.
4. Las razones deben ser concretas y con números (ej. "Promedia 251 yardas, pero Green Bay permite 178 por partido, 2.º mejor de la liga"). Nada de frases genéricas.
5. Si te doy "Datos reales de los últimos partidos", son box scores verificados: úsalos primero para córners, faltas, tarjetas, goles de campo, yardas y props, y no gastes búsquedas en lo que ya está ahí; busca lo que falte (lesiones, árbitro, temporada completa).
6. Si no encuentras un dato, dilo. Nunca inventes estadísticas ni lesiones.

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
  const sport = sportInfo(g.sport).label;
  const clip = (t: string, n: number) => String(t ?? "").slice(0, n);
  const lines: string[] = [];
  if (g.kind === "field") {
    lines.push(`Evento (${sport}): ${clip(g.title, 200)}`);
    if (g.field?.length) lines.push(`Participantes (orden de ESPN): ${g.field.slice(0, 40).join(", ")}.`);
  } else if (g.manual || !g.home.record) {
    lines.push(`Enfrentamiento (${sport}): ${clip(g.away.name, 100)} vs ${clip(g.home.name, 100)}${g.home.record ? ` (${g.away.record || "?"} / ${g.home.record})` : ""}`);
  } else {
    lines.push(
      `Partido (${sport}): ${g.away.name} (visitante, récord ${g.away.record || "?"}${g.away.form ? `, forma ${g.away.form}` : ""}) en ${g.home.name} (local, récord ${g.home.record || "?"}${g.home.form ? `, forma ${g.home.form}` : ""})`,
    );
  }
  lines.push(`Competencia: ${clip(g.leagueName, 150)}. Fecha: ${g.date}.${g.venue ? ` Sede: ${clip(g.venue, 100)}.` : ""}${g.status ? ` ${clip(g.status, 100)}.` : ""}`);
  if (g.manual) {
    lines.push("Evento escrito por el usuario: no hay datos de ESPN, búscalo todo en la web (confirma fecha, participantes y momios).");
    if (g.notes) lines.push(`Notas del usuario: ${clip(g.notes, 500)}`);
  }
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

// Los mercados de estadísticas (córners, tarjetas, props…) piden búsquedas propias.
const BASICOS = BASIC_MARKETS;
function searchBudget(ids: string[] | undefined) {
  const extra = (ids ?? []).filter((id) => !BASICOS.has(id)).length;
  return Math.min(18, 6 + extra * 2);
}

export function extractJson<T>(text: string): T | null {
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
  if (input.game) {
    parts.push(describeGame(input.game));
    const form = await recentForm(input.game, 5).catch(() => "");
    if (form) parts.push(form);
  }
  if (input.image) parts.push("Adjunto una captura de la pantalla que estoy viendo (casa de apuestas o quiniela). Analiza lo que aparece en ella.");
  const mercados = input.game ? describeMarkets(input.game.sport, input.mercados?.[input.game.sport]) : null;
  if (mercados) parts.push(`Mercados que me interesan: ${mercados.text}.`);
  if (input.question?.trim()) parts.push(`Lo que quiero saber: ${input.question.trim()}`);
  else if (input.game) parts.push("Dame un pick por cada mercado de la lista donde tengas datos.");

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (input.image) {
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: input.image } });
  }
  content.push({ type: "text", text: parts.join("\n\n") });

  const { text, fuentes, model, costo } = await runClaude(SYSTEM, content, searchBudget(mercados?.ids));

  const parsed = extractJson<Omit<Analysis, "fuentes" | "modelo">>(text);
  if (!parsed) {
    return {
      titulo: input.game?.title ?? "Análisis",
      resumen: text.replace(/<json>[\s\S]*$/, "").trim() || "La IA no devolvió un resultado legible. Intenta de nuevo.",
      picks: [],
      datos_clave: [],
      advertencias: ["No se pudo leer el formato del resultado."],
      fuentes,
      modelo: model,
      costo_usd: costo,
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
    costo_usd: costo,
  };
}

// Precios por millón de tokens (USD). Si respondió un modelo de respaldo, se cobra con su tarifa.
const RATES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-4-8": { input: 5, output: 25 },
};
const WEB_SEARCH_USD = 10 / 1000;

/** Costo en dólares de una respuesta de la API (tokens + búsquedas web). */
function costOf(m: Anthropic.Beta.BetaMessage): number {
  const r = RATES[m.model] ?? { input: 5, output: 25 }; // desconocido: tarifa alta para no subestimar
  const u = m.usage;
  const tokens =
    u.input_tokens * r.input +
    (u.cache_creation_input_tokens ?? 0) * r.input * 1.25 +
    (u.cache_read_input_tokens ?? 0) * r.input * 0.1 +
    u.output_tokens * r.output;
  return tokens / 1e6 + (u.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_USD;
}

export async function runClaude(
  system: string,
  content: Anthropic.Beta.BetaContentBlockParam[],
  maxSearches: number,
  effort: Effort = EFFORT,
) {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content }];
  let final: Anthropic.Beta.BetaMessage | null = null;
  let costo = 0;

  // pause_turn: la búsqueda web llegó a su límite de iteraciones; se reanuda con el turno parcial.
  for (let i = 0; i < 4; i++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools:
        maxSearches > 0
          ? [
              { type: "web_search_20260209", name: "web_search", max_uses: maxSearches },
              // Para leer tablas completas de estadísticas (córners, tarjetas, props) de las páginas encontradas.
              { type: "web_fetch_20260209", name: "web_fetch", max_uses: Math.ceil(maxSearches / 2) },
            ]
          : undefined,
      messages,
    });
    final = await stream.finalMessage();
    costo += costOf(final);
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
  return { text, fuentes: [...lista].map(([url, title]) => ({ url, title })), model: final.model, costo };
}

// ---------- Parlay ----------

const PARLAY_SYSTEM = `Eres un analista de apuestas de cualquier deporte o evento que ayuda a armar parlays, en español de México.

Recibes una lista de partidos (cada uno con su id). Para CADA partido:
1. Busca en la web datos ACTUALES: lesionados, forma reciente, estadísticas ofensivas y defensivas, local/visitante, descanso, clima si aplica, y los números de los jugadores clave (promedio de la temporada y de los últimos juegos, y qué permite el rival en esa estadística).
2. "opciones": de 3 a 8 apuestas sueltas de distinto riesgo, SOLO de los "Mercados a considerar" de ese partido (cubre todos los que puedas con datos; di en advertencias cuáles no). Incluye la MÁS PROBABLE (favorito, doble oportunidad, hándicap o total alterno) y alguna con mejor pago. Para córners, tarjetas, faltas, tiros o goles de campo usa promedios a favor y en contra de cada equipo y, en tarjetas y faltas, el promedio del árbitro designado. Esos datos están en FootyStats, FBref, SoccerStats, WhoScored, Flashscore, TeamRankings o Pro Football Reference: búscalos y abre la página con web_fetch para leer la tabla. Reparte tus búsquedas entre todos los mercados.
3. "combinadas": combinaciones del MISMO partido (same game parlay) con los tamaños que pida el mensaje ("Tamaños de combinadas"): al menos una combinada de CADA tamaño pedido, de la más probable a la de mejor pago. Si el mensaje dice que no hacen falta, deja "combinadas" vacío. Reglas:
   - Usa los mercados a considerar del partido. Cada selección de un mercado distinto. Nada redundante ni contradictorio: no juntes "X gana" con un hándicap de X, dos líneas del mismo total, ni dos props del mismo jugador y la misma estadística. Usa combinaciones que las casas sí aceptan, como "Cowboys ganan + Dak Prescott más de 224.5 yardas de pase" o "Más de 2.5 goles + Ambos anotan: Sí".
   - "probabilidad" es la probabilidad de que se cumplan TODAS juntas, considerando que están relacionadas. Si se ayudan entre sí (el equipo gana y su QB lanza mucho), la conjunta es MAYOR que multiplicarlas; si se estorban, es MENOR. No las multipliques sin más.
   - "cuota" es el momio americano aproximado que pagaría la casa por esa combinada.
4. Si un partido trae "Datos reales de los últimos partidos", son box scores verificados: úsalos primero (córners, faltas, tarjetas, goles de campo, yardas, props) y busca solo lo que falte.
5. Calcula las probabilidades con honestidad: parte del momio de la casa sin margen y muévete solo con evidencia concreta; ninguna suelta pasa de 90%. Nunca inventes estadísticas ni lesiones.
6. "seleccion" debe entenderse sola, sin leer el mercado (ej. "Ambos anotan: Sí", "Bears ganan", "Dak Prescott más de 224.5 yardas de pase").
7. "cuota" es el momio americano (ej. "-150", "+120"). Si viene en los datos o lo encontraste, pon "cuota_estimada": false. Si no lo sabes con exactitud, pon el momio típico del mercado y "cuota_estimada": true.

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

export async function analyzeParlayGames(
  games: Game[],
  seleccion?: MarketSelection,
  opts: { sameGame?: boolean; maxLegs?: number; comboMax?: number } = {},
) {
  const sameGame = opts.sameGame !== false;
  const comboMax = opts.comboMax || comboMaxSize(games.length, Math.min(20, Math.max(2, Number(opts.maxLegs) || 4)));
  const sizes = Array.from({ length: comboMax - 1 }, (_, i) => i + 2).join(", ");
  const comboLine = sameGame
    ? `Tamaños de combinadas del mismo partido: ${sizes} selecciones (una o más de cada tamaño por partido).`
    : "No hacen falta combinadas del mismo partido.";
  // Con muchos partidos, 3 juegos por equipo para no inflar el mensaje.
  const forms = await pool(games.map((g) => () => recentForm(g, games.length > 8 ? 3 : 5).catch(() => "")), 3);
  const today = new Date().toLocaleString("es-MX", { dateStyle: "full", timeStyle: "short", timeZone: "America/Mexico_City" });
  const text = [
    `Hoy es ${today} (hora del centro de México).`,
    comboLine,
    ...games.map(
      (g, i) =>
        `### Partido ${i + 1} (id: ${g.id})\n${describeGame(g)}\nMercados a considerar: ${describeMarkets(g.sport, seleccion?.[g.sport]).text}.${forms[i] ? `\n${forms[i]}` : ""}`,
    ),
  ].join("\n\n");

  // Búsquedas por partido según cuántos mercados de estadísticas se pidieron, con tope.
  const res = await runClaude(PARLAY_SYSTEM, [{ type: "text", text }], Math.min(40, games.reduce((n, g) => n + Math.ceil(searchBudget(describeMarkets(g.sport, seleccion?.[g.sport]).ids) / 3), 2)));
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
  return { juegos, advertencias: parsed.advertencias ?? [], fuentes: res.fuentes.slice(0, 15), modelo: res.model, costo_usd: res.costo };
}
