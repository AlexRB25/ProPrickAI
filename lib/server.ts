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
  blocked: boolean;
}

/** Para rutas de /api/admin: el usuario si es administrador. */
export async function requireAdmin(req: Request): Promise<User | NextResponse> {
  if (!dbConfigured()) return fail("Falta configurar Supabase.", 500);
  const user = await authUser(req);
  return user?.isAdmin ? user : fail("No autorizado", 401);
}

/** Usuario de la sesión (el cliente manda `Authorization: Bearer <access token>`). */
export async function authUser(req: Request): Promise<User | null> {
  const token = req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token || !dbConfigured()) return null;
  const { data, error } = await db().auth.getUser(token);
  if (error || !data.user) return null;
  const { data: profile } = await db().from("profiles").select("is_admin, blocked").eq("id", data.user.id).maybeSingle();
  return { id: data.user.id, email: data.user.email ?? "", isAdmin: Boolean(profile?.is_admin), blocked: Boolean(profile?.blocked) };
}

/** Vercel Cron manda CRON_SECRET como bearer; también pueden los administradores. */
export async function cronOrAdmin(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return Boolean((await authUser(req))?.isAdmin);
}

export const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** Comprobaciones comunes de las rutas que llaman a la IA. */
export async function requireUser(req: Request): Promise<User | NextResponse> {
  if (!process.env.ANTHROPIC_API_KEY) return fail("Falta ANTHROPIC_API_KEY en el servidor.", 500);
  if (!dbConfigured()) return fail("Falta configurar Supabase (PB_SUPABASE_URL y SUPABASE_SECRET_KEY).", 500);
  const user = await authUser(req);
  if (!user) return fail("Inicia sesión para usar la IA.", 401);
  if (user.blocked) return fail("Tu cuenta está bloqueada. Escríbenos si crees que es un error.", 403);
  return user;
}

/** Mensaje para el usuario a partir de un error de la IA. */
export function aiErrorMessage(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "La ANTHROPIC_API_KEY del servidor es inválida.";
  if (e instanceof Anthropic.RateLimitError) return "Demasiadas solicitudes a la IA, espera un momento.";
  if (e instanceof Anthropic.APIError) return `Error de la IA (${e.status}): ${e.message}`;
  return (e as Error)?.message ?? "Error desconocido";
}
