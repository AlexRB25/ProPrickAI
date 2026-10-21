// Solo para rutas de API: usa la llave secreta de Supabase. Nunca importar desde componentes del cliente.
import Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dbConfigured = () => Boolean(process.env.PB_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);

let client: SupabaseClient | undefined;

/** Salta RLS: lee y escribe todas las tablas de schema.sql. */
export function db(): SupabaseClient {
  return (client ??= createClient(process.env.PB_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  }));
}

export interface User {
  id: string;
  email: string;
  isAdmin: boolean;
}

/** Usuario de la sesión (el cliente manda `Authorization: Bearer <access token>`). */
export async function authUser(req: Request): Promise<User | null> {
  const token = req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token || !dbConfigured()) return null;
  const { data, error } = await db().auth.getUser(token);
  if (error || !data.user) return null;
  const { data: profile } = await db().from("profiles").select("is_admin").eq("id", data.user.id).maybeSingle();
  return { id: data.user.id, email: data.user.email ?? "", isAdmin: Boolean(profile?.is_admin) };
}

export const DAILY_LIMIT = Math.max(1, Number(process.env.DAILY_AI_LIMIT) || 10);

/** Gasta una consulta del día. Devuelve las que quedan (Infinity para admins) o null si ya no hay. */
export async function useQuota(user: User): Promise<number | null> {
  if (user.isAdmin) return Infinity;
  const { data, error } = await db().rpc("use_quota", { p_user: user.id, p_limit: DAILY_LIMIT });
  if (error) throw new Error(`No se pudo revisar tu límite diario: ${error.message}`);
  return data < 0 ? null : data;
}

export async function refundQuota(user: User) {
  if (!user.isAdmin) await db().rpc("refund_quota", { p_user: user.id });
}

/** Consultas que le quedan hoy sin gastar ninguna. */
export async function remainingQuota(user: User): Promise<number> {
  if (user.isAdmin) return Infinity;
  const day = new Date().toISOString().slice(0, 10);
  const { data } = await db().from("usage").select("count").eq("user_id", user.id).eq("day", day).maybeSingle();
  return Math.max(0, DAILY_LIMIT - (data?.count ?? 0));
}

/** Vercel Cron manda CRON_SECRET como bearer; también pueden los administradores. */
export async function cronOrAdmin(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return Boolean((await authUser(req))?.isAdmin);
}

export const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

// JSON no admite Infinity: los admins ven null (= sin límite).
export const quotaOut = (n: number) => (Number.isFinite(n) ? n : null);

/** Comprobaciones comunes de las rutas que llaman a la IA. */
export async function requireUser(req: Request): Promise<User | NextResponse> {
  if (!process.env.ANTHROPIC_API_KEY) return fail("Falta ANTHROPIC_API_KEY en el servidor.", 500);
  if (!dbConfigured()) return fail("Falta configurar Supabase (PB_SUPABASE_URL y SUPABASE_SECRET_KEY).", 500);
  const user = await authUser(req);
  return user ?? fail("Inicia sesión para usar la IA.", 401);
}

/** Mensaje para el usuario a partir de un error de la IA. */
export function aiErrorMessage(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "La ANTHROPIC_API_KEY del servidor es inválida.";
  if (e instanceof Anthropic.RateLimitError) return "Demasiadas solicitudes a la IA, espera un momento.";
  if (e instanceof Anthropic.APIError) return `Error de la IA (${e.status}): ${e.message}`;
  return (e as Error)?.message ?? "Error desconocido";
}
