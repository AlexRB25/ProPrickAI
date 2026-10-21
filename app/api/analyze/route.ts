import { NextResponse } from "next/server";
import { analyze, type Analysis, type AnalyzeInput } from "@/lib/ai";
import { getCached, partidoKey, putAnalysis, recordPicks, resolveGame } from "@/lib/cache";
import type { Game } from "@/lib/espn";
import { describeMarkets } from "@/lib/markets";
import { aiErrorMessage, DAILY_LIMIT, fail, quotaOut, refundQuota, remainingQuota, requireUser, useQuota } from "@/lib/server";

// La búsqueda web puede tardar 1-3 minutos.
export const maxDuration = 300;

const MAX_IMAGE = 6_000_000; // ~4.5 MB en base64

export async function POST(req: Request) {
  const user = await requireUser(req);
  if (user instanceof NextResponse) return user;

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

  // Solo se comparte el análisis de un partido sin captura (la captura es distinta cada vez).
  const key = game && !body.image ? partidoKey(game, describeMarkets(game.sport, body.mercados?.[game.sport]).ids, question) : null;
  if (key && !body.refresh) {
    const hit = await getCached<Analysis>(key);
    if (hit) {
      return NextResponse.json({
        ...hit.result,
        cache: { hit: true, creado: hit.created_at },
        restantes: quotaOut(await remainingQuota(user)),
      } satisfies Analysis);
    }
  }

  const left = await useQuota(user);
  if (left === null) return fail(`Llegaste a tu límite de ${DAILY_LIMIT} análisis de IA por hoy. Lo que ya esté en caché no cuenta.`, 429);

  try {
    const a = await analyze({ ...body, game: game ?? undefined, question });
    let creado = new Date().toISOString();
    if (key && game) {
      const saved = await putAnalysis({ key, kind: "partido", game, result: a, model: a.modelo, userId: user.id });
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
    return NextResponse.json({ ...a, cache: { hit: false, creado }, restantes: quotaOut(left) } satisfies Analysis);
  } catch (e) {
    await refundQuota(user);
    return fail(aiErrorMessage(e), 500);
  }
}
