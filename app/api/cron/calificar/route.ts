import { NextResponse } from "next/server";
import { gradePending } from "@/lib/grade";
import { cronOrAdmin, dbConfigured, fail } from "@/lib/server";

// Califica los picks de partidos terminados. Lo llama Vercel Cron (GET) o un admin desde Efectividad (POST).
export const maxDuration = 300;

async function run(req: Request) {
  if (!dbConfigured() || !process.env.ANTHROPIC_API_KEY) return fail("Falta configurar Supabase o la API de Anthropic.", 500);
  if (!(await cronOrAdmin(req))) return fail("No autorizado", 401);
  try {
    return NextResponse.json(await gradePending(12));
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}

export const GET = run;
export const POST = run;
