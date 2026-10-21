// Califica los picks pendientes cuando ya terminó el partido.
// Con resultado de ESPN, la IA solo compara (sin búsqueda); sin él (evento manual, torneo, pelea), busca el resultado.
import { extractJson, runClaude } from "./ai";
import { logConsulta } from "./billing";
import type { Game } from "./espn";
import { db } from "./server";
import { finalReport } from "./stats";

interface PickRow {
  id: string;
  game_id: string;
  game: Game;
  title: string;
  game_date: string;
  mercado: string;
  seleccion: string;
  selecciones: { mercado: string; seleccion: string }[] | null;
  intentos: number;
}

type Estado = "ganada" | "perdida" | "push" | "anulada" | "pendiente";

const GRADER = `Calificas apuestas deportivas ya jugadas, en español. Para cada apuesta decide:
- "ganada" si se cumplió; "perdida" si no;
- "push" si cayó exacto en la línea (ej. más de 3 goles y hubo 3) y la casa devuelve el dinero;
- "anulada" si el evento no se jugó, se suspendió o el jugador no participó (las casas anulan esas apuestas);
- "pendiente" SOLO si no tienes el dato para decidir.
Las apuestas "Combinada del mismo partido" se ganan solo si se cumplen TODAS sus selecciones.
Usa únicamente el resultado oficial que te doy o que encuentres; no adivines. En "motivo" pon el dato que lo decide (ej. "Hubo 11 córners (6+5)").

Responde al final EXACTAMENTE así, entre <json> y </json>:
<json>
{ "calificaciones": [ { "id": "id de la apuesta", "estado": "ganada", "motivo": "..." } ] }
</json>`;

const HOURS = 3600000;
const FINAL: Estado[] = ["ganada", "perdida", "push", "anulada"];

// Cuánto esperar después del inicio para buscar el resultado: torneos y carreras duran días.
function readyAt(g: Game) {
  return Date.parse(g.date) + (g.kind === "field" ? 4 * 24 * HOURS : 3 * HOURS);
}

export interface GradeSummary {
  partidos: number;
  calificados: number;
  sinResultado: number;
  errores: string[];
}

export async function gradePending(maxGames = 12): Promise<GradeSummary> {
  const out: GradeSummary = { partidos: 0, calificados: 0, sinResultado: 0, errores: [] };
  const { data, error } = await db()
    .from("picks")
    .select("id, game_id, game, title, game_date, mercado, seleccion, selecciones, intentos")
    .eq("status", "pendiente")
    .lt("game_date", new Date(Date.now() - 3 * HOURS).toISOString())
    .order("game_date", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);

  const groups = new Map<string, PickRow[]>();
  for (const p of (data ?? []) as PickRow[]) {
    if (Date.now() < readyAt(p.game)) continue;
    if (!groups.has(p.game_id)) groups.set(p.game_id, []);
    groups.get(p.game_id)!.push(p);
  }

  for (const picks of [...groups.values()].slice(0, maxGames)) {
    out.partidos++;
    try {
      const n = await gradeGame(picks);
      out.calificados += n;
      if (n === 0) out.sinResultado++;
    } catch (e) {
      out.errores.push(`${picks[0].title}: ${(e as Error).message}`);
    }
  }
  return out;
}

async function gradeGame(picks: PickRow[]): Promise<number> {
  const game = picks[0].game;
  const report = await finalReport(game).catch(() => null);

  // ESPN dice que aún no termina: esperar, salvo que ya pasaron 3 días (entonces se busca en la web).
  const stale = Date.now() - Date.parse(game.date) > 3 * 24 * HOURS;
  if (report && !report.final && !stale) {
    for (const p of picks) await db().from("picks").update({ intentos: p.intentos + 1 }).eq("id", p.id);
    return 0;
  }

  const espn = report?.final ? report.text : null;
  const { byId, costo } = await askGrader(game, picks, espn);
  await logConsulta({ userId: null, tipo: "calificacion", titulo: game.title, creditos: 0, costo });
  const by = espn ? "espn" : "web";

  let graded = 0;
  for (const p of picks) {
    const c = byId.get(p.id);
    if (!c || !FINAL.includes(c.estado)) {
      // Tras 10 intentos sin resultado se anula para que no se quede colgado.
      const giveUp = p.intentos + 1 >= 10;
      await db()
        .from("picks")
        .update(
          giveUp
            ? { status: "anulada", resultado: "Sin resultado disponible", graded_by: by, graded_at: new Date().toISOString() }
            : { intentos: p.intentos + 1 },
        )
        .eq("id", p.id);
      continue;
    }
    await db()
      .from("picks")
      .update({ status: c.estado, resultado: String(c.motivo ?? "").slice(0, 500), graded_by: by, graded_at: new Date().toISOString() })
      .eq("id", p.id)
      .eq("status", "pendiente");
    graded++;
  }
  return graded;
}

/** Pregunta a la IA el estado de cada pick. Con el resultado de ESPN no busca; sin él, busca en la web. */
export async function askGrader(
  game: Game,
  picks: Pick<PickRow, "id" | "mercado" | "seleccion" | "selecciones">[],
  espnReport: string | null,
) {
  const lista = picks
    .map((p) => {
      const sels = p.selecciones?.length ? ` (selecciones: ${p.selecciones.map((s) => s.seleccion).join(" + ")})` : "";
      return `- id ${p.id} · ${p.mercado}: ${p.seleccion}${sels}`;
    })
    .join("\n");
  const text = [
    `Evento: ${game.title} (${game.leagueName}), fecha ${game.date}.`,
    espnReport ? `Resultado oficial de ESPN:\n${espnReport}` : "No tengo el resultado: búscalo en la web (marcador final y las estadísticas que necesites).",
    `Apuestas a calificar:\n${lista}`,
  ].join("\n\n");
  const res = await runClaude(GRADER, [{ type: "text", text }], espnReport ? 0 : 5, "low");
  const parsed = extractJson<{ calificaciones?: { id: string; estado: Estado; motivo?: string }[] }>(res.text);
  return { byId: new Map((parsed?.calificaciones ?? []).map((c) => [String(c.id), c])), costo: res.costo };
}
