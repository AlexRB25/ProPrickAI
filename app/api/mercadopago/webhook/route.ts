import { createHmac, timingSafeEqual } from "node:crypto";
import { paymentsConfigured, syncAuthorizedPayment, syncPayment, syncPreapproval } from "@/lib/mercadopago";
import { dbConfigured } from "@/lib/server";

/**
 * Revisa el encabezado x-signature ("ts=…,v1=…"): v1 es el HMAC-SHA256 en hex de
 * "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" con la clave secreta del webhook.
 */
function validSignature(req: Request, dataId: string, secret: string) {
  const parts = Object.fromEntries(
    (req.headers.get("x-signature") ?? "").split(",").map((p) => p.trim().split("=") as [string, string]),
  );
  if (!parts.ts || !parts.v1) return false;
  const manifest = `id:${dataId.toLowerCase()};request-id:${req.headers.get("x-request-id") ?? ""};ts:${parts.ts};`;
  const expected = Buffer.from(createHmac("sha256", secret).update(manifest).digest("hex"));
  const received = Buffer.from(parts.v1);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/**
 * Mercado Pago avisa aquí de suscripciones (alta, pausa, cancelación), de cada cobro de una
 * suscripción y de los pagos de paquetes. Cualquier respuesta que no sea 200/201 hace que reintente,
 * así que solo los errores temporales responden con error. Nunca se confía en el contenido del aviso:
 * todo se vuelve a leer de la API de Mercado Pago.
 */
export async function POST(req: Request) {
  if (!paymentsConfigured() || !dbConfigured()) return new Response(null, { status: 503 });

  const url = new URL(req.url);
  const body = await req.json().catch(() => null);
  const type = body?.type ?? url.searchParams.get("type") ?? url.searchParams.get("topic");
  const id = String(body?.data?.id ?? url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "");
  if (!id) return new Response(null, { status: 200 });

  const secret = process.env.MP_WEBHOOK_SECRET;
  if (secret && !validSignature(req, url.searchParams.get("data.id") ?? id, secret)) {
    return new Response(null, { status: 401 });
  }

  let result: "ok" | "ignored" | "retry" = "ignored";
  if (type === "subscription_preapproval") result = await syncPreapproval(id);
  else if (type === "subscription_authorized_payment") result = await syncAuthorizedPayment(id);
  else if (type === "payment") result = await syncPayment(id);
  return new Response(null, { status: result === "retry" ? 502 : 200 });
}
