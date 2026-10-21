import { NextResponse } from "next/server";
import { db, requireAdmin } from "@/lib/server";

export const dynamic = "force-dynamic";

const PAGE = 100;

/** Historial de consultas de todos los usuarios, del más reciente al más viejo. ?tipo=&page= */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  const params = new URL(req.url).searchParams;
  const tipo = params.get("tipo") ?? "";
  const page = Math.max(0, Number(params.get("page")) || 0);

  let query = db()
    .from("consultas")
    .select("id, user_id, tipo, titulo, creditos, costo_usd, cache, ok, error, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(page * PAGE, page * PAGE + PAGE - 1);
  if (tipo) query = query.eq("tipo", tipo);
  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = [...new Set((data ?? []).map((c) => c.user_id).filter(Boolean))] as string[];
  const emails = ids.length ? (await db().from("profiles").select("id, email").in("id", ids)).data ?? [] : [];
  const byId = new Map(emails.map((e) => [e.id, e.email]));
  return NextResponse.json({
    consultas: (data ?? []).map((c) => ({ ...c, email: c.user_id ? (byId.get(c.user_id) ?? "") : "sistema" })),
    total: count ?? 0,
    hayMas: (count ?? 0) > (page + 1) * PAGE,
  });
}
