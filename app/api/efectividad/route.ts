import { NextResponse } from "next/server";
import { computeStats, type PickPublic } from "@/lib/efectividad";
import { db, dbConfigured, fail } from "@/lib/server";

// Pública: estadísticas de efectividad y lista de picks del más reciente al más viejo.
// Filtros: ?sport=&league=&status=&page=
export const dynamic = "force-dynamic";

const PAGE = 50;

export async function GET(req: Request) {
  if (!dbConfigured()) return fail("Falta configurar Supabase.", 500);
  const q = new URL(req.url).searchParams;
  const sport = q.get("sport") ?? "";
  const league = q.get("league") ?? "";
  const status = q.get("status") ?? "";
  const page = Math.max(0, Number(q.get("page")) || 0);

  const { data, error } = await db()
    .from("picks")
    .select("id, sport, league_name, title, game_date, mercado, seleccion, probabilidad, cuota, cuota_estimada, status, resultado, graded_by, origen")
    .order("game_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) return fail(error.message, 500);
  const all = (data ?? []) as PickPublic[];

  // Opciones de filtro: deportes con picks y, del deporte elegido, sus ligas.
  const sports = [...new Set(all.map((p) => p.sport))].sort();
  const leagues = [...new Set(all.filter((p) => !sport || p.sport === sport).map((p) => p.league_name))].sort();

  const filtered = all.filter((p) => (!sport || p.sport === sport) && (!league || p.league_name === league));
  const listed = status ? filtered.filter((p) => p.status === status) : filtered;

  return NextResponse.json(
    {
      stats: computeStats(filtered),
      picks: listed.slice(page * PAGE, (page + 1) * PAGE),
      hayMas: listed.length > (page + 1) * PAGE,
      totalLista: listed.length,
      filtros: { sports, leagues },
    },
    { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" } },
  );
}
