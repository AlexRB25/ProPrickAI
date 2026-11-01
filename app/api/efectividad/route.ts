import { NextResponse } from "next/server";
import { computeStats, type PickPublic } from "@/lib/efectividad";
import { db, dbConfigured, fail } from "@/lib/server";

// Pública: estadísticas de efectividad y lista de picks del más reciente al más viejo.
// Filtros: ?sport=&league=&status=&page=&periodo=todo|jornada|jornadas2|mes|rango&desde=AAAA-MM-DD&hasta=AAAA-MM-DD
export const dynamic = "force-dynamic";

const PAGE = 50;
const DAY = 86400000;
const MX = 6 * 3600000; // centro de México, UTC-6 todo el año

/** Lunes 00:00 (hora de México) de la semana de t, en milisegundos UTC. */
function inicioSemana(t: number) {
  const local = new Date(t - MX);
  const dia = (local.getUTCDay() + 6) % 7; // lunes = 0
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - dia) + MX;
}

const fechaMx = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? Date.parse(`${iso}T00:00:00Z`) + MX : null);

export async function GET(req: Request) {
  if (!dbConfigured()) return fail("Falta configurar Supabase.", 500);
  const q = new URL(req.url).searchParams;
  const sport = q.get("sport") ?? "";
  const league = q.get("league") ?? "";
  const status = q.get("status") ?? "";
  const page = Math.max(0, Number(q.get("page")) || 0);
  const periodo = q.get("periodo") ?? "todo";

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

  const porLiga = all.filter((p) => (!sport || p.sport === sport) && (!league || p.league_name === league));

  // Periodo. "Jornada" = semana de lunes a domingo; la última es la más reciente con picks ya calificados.
  let desde: number | null = null;
  let hasta: number | null = null;
  if (periodo === "jornada" || periodo === "jornadas2") {
    const decididos = porLiga.filter((p) => p.status !== "pendiente");
    const ref = (decididos.length ? decididos : porLiga)[0]?.game_date; // vienen del más reciente al más viejo
    if (ref) {
      const lunes = inicioSemana(Date.parse(ref));
      desde = periodo === "jornada" ? lunes : lunes - 7 * DAY;
      hasta = lunes + 7 * DAY - 1;
    }
  } else if (periodo === "mes") {
    desde = Date.now() - 30 * DAY;
    hasta = Date.now();
  } else if (periodo === "rango") {
    desde = fechaMx(q.get("desde"));
    const h = fechaMx(q.get("hasta"));
    hasta = h == null ? null : h + DAY - 1;
  }
  const filtered = porLiga.filter((p) => {
    const t = Date.parse(p.game_date);
    return (desde == null || t >= desde) && (hasta == null || t <= hasta);
  });
  const listed = status ? filtered.filter((p) => p.status === status) : filtered;

  return NextResponse.json(
    {
      stats: computeStats(filtered),
      picks: listed.slice(page * PAGE, (page + 1) * PAGE),
      hayMas: listed.length > (page + 1) * PAGE,
      totalLista: listed.length,
      filtros: { sports, leagues },
      periodo: { desde: desde == null ? null : new Date(desde).toISOString(), hasta: hasta == null ? null : new Date(hasta).toISOString() },
    },
    { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" } },
  );
}
