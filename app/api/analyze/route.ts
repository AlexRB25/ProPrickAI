import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { analyze, type AnalyzeInput } from "@/lib/ai";

// La búsqueda web puede tardar 1-3 minutos.
export const maxDuration = 300;

const MAX_IMAGE = 6_000_000; // ~4.5 MB en base64

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Falta ANTHROPIC_API_KEY en .env.local del servidor." }, { status: 500 });
  }
  let body: AnalyzeInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }
  if (!body.image && !body.game && !body.question?.trim()) {
    return NextResponse.json({ error: "Manda una captura, un partido o una pregunta." }, { status: 400 });
  }
  if (body.image && (typeof body.image !== "string" || body.image.length > MAX_IMAGE)) {
    return NextResponse.json({ error: "La captura es demasiado grande." }, { status: 413 });
  }
  if (body.question && body.question.length > 1000) body.question = body.question.slice(0, 1000);

  try {
    return NextResponse.json(await analyze(body));
  } catch (e) {
    let msg = (e as Error).message;
    if (e instanceof Anthropic.AuthenticationError) msg = "Falta o es inválida la ANTHROPIC_API_KEY en el servidor.";
    else if (e instanceof Anthropic.RateLimitError) msg = "Demasiadas solicitudes a la IA, espera un momento.";
    else if (e instanceof Anthropic.APIError) msg = `Error de la IA (${e.status}): ${e.message}`;
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
