import { NextResponse } from "next/server";
import { db, fail, requireAdmin } from "@/lib/server";

/** Oculta o vuelve a mostrar un comentario: { id, oculto }. */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  const b = await req.json().catch(() => null);
  const { error } = await db().from("comentarios").update({ oculto: Boolean(b?.oculto) }).eq("id", Number(b?.id));
  return error ? fail(error.message, 500) : NextResponse.json({ ok: true });
}
