"use client";
// Cliente del navegador: solo para iniciar sesión. Los datos se leen por las rutas de API.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.PB_SUPABASE_URL;
const key = process.env.PB_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = Boolean(url && key);

let client: SupabaseClient | undefined;

export function supabase(): SupabaseClient {
  return (client ??= createClient(url || "https://sin-configurar.supabase.co", key || "sin-configurar"));
}

/** fetch con el token de la sesión para las rutas que piden usuario. */
export async function authFetch(input: string, init: RequestInit = {}) {
  const { data } = await supabase().auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
  return fetch(input, { ...init, headers });
}

export function authErrorMessage(error: { code?: string; message: string }): string {
  switch (error.code) {
    case "invalid_credentials":
      return "Correo o contraseña incorrectos.";
    case "user_already_exists":
    case "email_exists":
      return "Ya existe una cuenta con ese correo.";
    case "weak_password":
      return "La contraseña es demasiado débil. Usa al menos 8 caracteres.";
    case "email_not_confirmed":
      return "Confirma tu correo con el enlace que te enviamos antes de entrar.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Demasiados intentos. Espera un momento y vuelve a probar.";
    case "email_address_invalid":
    case "validation_failed":
      return "Revisa el correo y la contraseña.";
    default:
      if (/fetch|network/i.test(error.message)) return "No se pudo conectar con el servidor. Revisa tu conexión.";
      return `Algo salió mal: ${error.message}`;
  }
}
