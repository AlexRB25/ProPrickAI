import { NextResponse } from "next/server";
import { analyze, type Analysis, type AnalyzeInput } from "@/lib/ai";
import { charge, getTarifas, hasAccess, logConsulta, refund, SIN_SUSCRIPCION, sinCreditos } from "@/lib/billing";
import { getCached, partidoKey, putAnalysis, recordPicks, resolveGame } from "@/lib/cache";
import type { Game } from "@/lib/espn";
import { describeMarkets, isExtended } from "@/lib/markets";
import { aiErrorMessage, fail, requireUser } from "@/lib/server";

// La búsqueda web puede tardar 1-3 minutos.
export const maxDuration = 300;

const MAX_IMAGE = 6_000_000; // ~4.5 MB en base64

// El costo real de la IA nunca se manda al navegador.
const publico = (a: Analysis) => ({ ...a, costo_usd: undefined });

export async function POST(req: Request) {
  const user = await requireUser(req);
  if (user instanceof NextResponse) return user;
  if (!(await hasAccess(user))) return fail(SIN_SUSCRIPCION, 402);

  let body: AnalyzeInput & { refresh?: boolean };
  try {
    body = await req.json();
  } catch {
    return fail("Solicitud inválida");
  }
  const question = String(body.question ?? "").slice(0, 1000);
  if (!body.image && !body.game && !question.trim()) return fail("Manda una captura, un partido o una pregunta.");
  if (body.image && (typeof body.image !== "string" || body.image.length > MAX_IMAGE)) return fail("La captura es demasiado grande.", 413);

  let game: Game | null = null;
  if (body.game) {
    game = await resolveGame(body.game);
    if (!game) return fail("No encontré ese partido en el calendario. Recarga la lista.", 404);
  }

  const tarifas = await getTarifas();
  const ids = game ? describeMarkets(game.sport, body.mercados?.[game.sport]).ids : [];
  const titulo = game?.title ?? (body.image ? "Captura de pantalla" : question.slice(0, 120));
  const tipo = body.image ? "captura" : "analisis";

  // Solo se comparte el análisis de un partido sin captura (la captura es distinta cada vez).
  const key = game && !body.image ? partidoKey(game, ids, question) : null;
  if (key && !body.refresh) {
    const hit = await getCached<Analysis>(key);
    if (hit) {
      const c = await charge(user, tarifas.analisis_cache, `cache:${titulo}`);
      if (!c.ok) return fail(sinCreditos(c), 402);
      await logConsulta({ userId: user.id, tipo: "analisis", titulo, creditos: user.isAdmin ? 0 : tarifas.analisis_cache, costo: 0, cache: true });
      return NextResponse.json({ ...publico(hit.result), cache: { hit: true, creado: hit.created_at }, restantes: c.saldo } satisfies Analysis);
    }
  }

  const precio = body.image ? tarifas.captura : tarifas.analisis + (isExtended(ids) ? tarifas.analisis_extendido : 0);
  const c = await charge(user, precio, `${tipo}:${titulo}`);
  if (!c.ok) return fail(sinCreditos(c), 402);
  const cobrado = user.isAdmin ? 0 : precio;

  try {
    const a = await analyze({ ...body, game: game ?? undefined, question });
    let creado = new Date().toISOString();
    if (key && game) {
      const saved = await putAnalysis({ key, kind: "partido", game, result: publico(a), model: a.modelo, userId: user.id });
      if (saved) creado = saved.created_at;
      await recordPicks(
        saved?.id ?? null,
        "partido",
        game,
        a.picks.map((p) => ({
          mercado: p.mercado,
          seleccion: p.seleccion,
          probabilidad: p.probabilidad,
          cuota: p.cuota,
          cuota_estimada: !p.cuota || p.valor === "sin cuota",
        })),
      );
    }
    await logConsulta({ userId: user.id, tipo, titulo, creditos: cobrado, costo: a.costo_usd ?? 0 });
    return NextResponse.json({ ...publico(a), cache: { hit: false, creado }, restantes: c.saldo } satisfies Analysis);
  } catch (e) {
    const msg = aiErrorMessage(e);
    await refund(user, cobrado, `${tipo}:${titulo}`);
    await logConsulta({ userId: user.id, tipo, titulo, creditos: 0, costo: 0, ok: false, error: msg });
    return fail(`${msg}${cobrado ? " No se te cobraron créditos." : ""}`, 500);
  }
}
