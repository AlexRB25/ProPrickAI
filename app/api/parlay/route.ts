import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { analyzeParlayGames } from "@/lib/ai";
import type { Game } from "@/lib/espn";
import type { MarketSelection } from "@/lib/markets";

// Tope del plan Hobby de Vercel; con muchos partidos la IA puede tardar varios minutos.
export const maxDuration = 300;

const MAX_PARLAY_GAMES = 20;

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Falta ANTHROPIC_API_KEY en .env.local del servidor." }, { status: 500 });
  }
  let games: Game[];
  let mercados: MarketSelection | undefined;
  let sameGame = true;
  let maxLegs = 4;
  try {
    const body = await req.json();
    games = body.games;
    mercados = body.mercados;
    sameGame = body.sameGame !== false;
    maxLegs = Number(body.maxLegs) || 4;
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }
  if (!Array.isArray(games) || games.length < 1 || (games.length < 2 && !sameGame)) {
    return NextResponse.json({ error: "Agrega al menos 2 partidos, o 1 con apuestas del mismo partido activadas." }, { status: 400 });
  }
  if (games.length > MAX_PARLAY_GAMES) {
    return NextResponse.json({ error: `Máximo ${MAX_PARLAY_GAMES} partidos por análisis.` }, { status: 400 });
  }

  try {
    return NextResponse.json(await analyzeParlayGames(games, mercados, { sameGame, maxLegs }));
  } catch (e) {
    let msg = (e as Error).message;
    if (e instanceof Anthropic.AuthenticationError) msg = "La ANTHROPIC_API_KEY del servidor es inválida.";
    else if (e instanceof Anthropic.RateLimitError) msg = "Demasiadas solicitudes a la IA, espera un momento.";
    else if (e instanceof Anthropic.APIError) msg = `Error de la IA (${e.status}): ${e.message}`;
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
