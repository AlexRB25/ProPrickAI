import { NextResponse } from "next/server";
import { fetchGames } from "@/lib/espn";

export async function GET(req: Request) {
  const league = new URL(req.url).searchParams.get("league") ?? "nfl";
  try {
    return NextResponse.json({ games: await fetchGames(league) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
