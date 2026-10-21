"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LEAGUES, type Game, type Sport } from "@/lib/espn";
import type { Analysis } from "@/lib/ai";
import { buildParlays, comboMaxSize, MAX_APUESTAS, type GameOptions } from "@/lib/parlay";
import { AnalysisView } from "./AnalysisView";
import { ParlayView } from "./ParlayView";
import { MarketPicker } from "./MarketPicker";
import { DEFAULT_MARKETS, type MarketSelection } from "@/lib/markets";

declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow(opts: { width: number; height: number }): Promise<Window>;
    };
  }
}

const SPORTS: { id: Sport; label: string }[] = [
  { id: "americano", label: "🏈 Fútbol americano" },
  { id: "soccer", label: "⚽ Fútbol soccer" },
  { id: "basquet", label: "🏀 Básquetbol" },
];

const HISTORY_KEY = "pronosticos-historial";
const PARLAY_KEY = "pronosticos-parlay";
const MARKETS_KEY = "pronosticos-mercados";
const MAX_PARLAY_GAMES = 20;
const TAMANOS = Array.from({ length: MAX_APUESTAS - 1 }, (_, i) => i + 2);

interface ParlayData {
  juegos: GameOptions[];
  advertencias: string[];
  fuentes: { title: string; url: string }[];
}

async function requestAnalysis(body: { image?: string; game?: Game; question?: string; mercados?: MarketSelection }): Promise<Analysis> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: `Error ${res.status}` }));
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data;
}

// Captura un cuadro del video compartido. ImageCapture sigue funcionando aunque esta pestaña esté en segundo plano.
async function captureFrame(track: MediaStreamTrack, video: HTMLVideoElement | null): Promise<string> {
  let source: CanvasImageSource | null = null;
  let w = 0;
  let h = 0;
  const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { grabFrame(): Promise<ImageBitmap> } }).ImageCapture;
  if (IC) {
    try {
      const bmp = await new IC(track).grabFrame();
      source = bmp;
      w = bmp.width;
      h = bmp.height;
    } catch {
      source = null;
    }
  }
  if (!source && video && video.videoWidth) {
    source = video;
    w = video.videoWidth;
    h = video.videoHeight;
  }
  if (!source) throw new Error("No se pudo capturar la pantalla. Vuelve a compartirla.");

  const scale = Math.min(1, 1600 / w);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
}

function copyStyles(target: Window) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const style = target.document.createElement("style");
      style.textContent = Array.from(sheet.cssRules).map((r) => r.cssText).join("\n");
      target.document.head.appendChild(style);
    } catch {
      if (sheet.href) {
        const link = target.document.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        target.document.head.appendChild(link);
      }
    }
  }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("es-MX", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function Loading({ text }: { text: string }) {
  return (
    <div className="row muted">
      <span className="spinner" /> {text}
    </div>
  );
}

export default function Home() {
  const [tab, setTab] = useState<"partidos" | "parlay" | "pantalla">("partidos");

  // Parlay
  const [legs, setLegs] = useState<Game[]>([]);
  const [minLegs, setMinLegs] = useState(2);
  const [maxLegs, setMaxLegs] = useState(4);
  const [sameGame, setSameGame] = useState(true);
  const minGames = sameGame ? 1 : 2;
  const [mercados, setMercados] = useState<MarketSelection>(DEFAULT_MARKETS);
  const [parlayData, setParlayData] = useState<ParlayData | null>(null);
  const [parlayBusy, setParlayBusy] = useState(false);
  const [parlayError, setParlayError] = useState("");

  // Partidos
  const [sport, setSport] = useState<Sport>("americano");
  const [league, setLeague] = useState("nfl");
  const [games, setGames] = useState<Game[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [gamesError, setGamesError] = useState("");
  const [selected, setSelected] = useState<Game | null>(null);
  const [question, setQuestion] = useState("");

  // Resultado
  const [result, setResult] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<Analysis[]>([]);

  // Pantalla
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [pip, setPip] = useState<Window | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) setHistory(JSON.parse(saved));
      const savedMarkets = localStorage.getItem(MARKETS_KEY);
      if (savedMarkets) setMercados({ ...DEFAULT_MARKETS, ...JSON.parse(savedMarkets) });
      const savedLegs = localStorage.getItem(PARLAY_KEY);
      if (savedLegs) setLegs(JSON.parse(savedLegs));
    } catch {}
  }, []);

  function saveMercados(next: MarketSelection) {
    setMercados(next);
    try {
      localStorage.setItem(MARKETS_KEY, JSON.stringify(next));
    } catch {}
  }

  function saveLegs(next: Game[]) {
    setLegs(next);
    try {
      localStorage.setItem(PARLAY_KEY, JSON.stringify(next));
    } catch {}
  }

  function toggleLeg(g: Game) {
    if (legs.some((l) => l.id === g.id)) saveLegs(legs.filter((l) => l.id !== g.id));
    else if (legs.length < MAX_PARLAY_GAMES) saveLegs([...legs, g]);
    else setParlayError(`Máximo ${MAX_PARLAY_GAMES} partidos por parlay.`);
  }

  async function armarParlay() {
    setParlayBusy(true);
    setParlayError("");
    try {
      const res = await fetch("/api/parlay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ games: legs, mercados, sameGame, maxLegs }),
      });
      const data = await res.json().catch(() => ({ error: `Error ${res.status}` }));
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setParlayData(data);
    } catch (e) {
      setParlayError((e as Error).message);
    } finally {
      setParlayBusy(false);
    }
  }

  // Solo combina partidos que siguen en el boleto; si se agregó uno nuevo hay que volver a analizar.
  const legIds = new Set(legs.map((l) => l.id));
  const analyzedJuegos = parlayData?.juegos.filter((j) => legIds.has(j.id)) ?? [];
  const pendingLegs = parlayData ? legs.filter((l) => !parlayData.juegos.some((j) => j.id === l.id)).length : 0;
  const parlays = parlayData ? buildParlays(analyzedJuegos, minLegs, maxLegs, sameGame) : [];

  useEffect(() => {
    const l = LEAGUES.find((x) => x.id === league);
    if (l?.sport !== sport) setLeague(LEAGUES.find((x) => x.sport === sport)!.id);
  }, [sport, league]);

  useEffect(() => {
    let cancel = false;
    setGamesLoading(true);
    setGamesError("");
    setSelected(null);
    fetch(`/api/games?league=${encodeURIComponent(league)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancel) return;
        if (d.error) throw new Error(d.error);
        setGames(d.games);
      })
      .catch((e) => !cancel && setGamesError(e.message))
      .finally(() => !cancel && setGamesLoading(false));
    return () => {
      cancel = true;
    };
  }, [league]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream, tab]);

  const run = useCallback(async (body: { image?: string; game?: Game; question?: string; mercados?: MarketSelection }) => {
    setBusy(true);
    setError("");
    try {
      const a = await requestAnalysis(body);
      setResult(a);
      setHistory((h) => {
        const next = [a, ...h].slice(0, 15);
        try {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  async function startShare() {
    setError("");
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
      s.getVideoTracks()[0].addEventListener("ended", () => setStream(null));
      setStream(s);
    } catch (e) {
      if ((e as Error).name !== "NotAllowedError") setError((e as Error).message);
    }
  }

  function stopShare() {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
  }

  async function analyzeScreen() {
    const track = stream?.getVideoTracks()[0];
    if (!track || track.readyState !== "live") {
      setError("Primero comparte la pantalla de la casa de apuestas.");
      return;
    }
    try {
      const image = await captureFrame(track, videoRef.current);
      await run({ image, question: note });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function openFloat() {
    if (!window.documentPictureInPicture) {
      setError("Tu navegador no permite ventanas flotantes. Usa Chrome o Edge en computadora.");
      return;
    }
    if (pip) {
      pip.focus();
      return;
    }
    const w = await window.documentPictureInPicture.requestWindow({ width: 400, height: 620 });
    copyStyles(w);
    w.document.title = "Pronósticos IA";
    w.addEventListener("pagehide", () => setPip(null));
    setPip(w);
  }

  useEffect(() => () => pip?.close(), [pip]);

  const floatPanel = (
    <div className="float">
      <div className="row">
        <div className="brand">Pronósticos <span>IA</span></div>
        <span className="small muted" style={{ marginLeft: "auto" }}>{stream ? "● compartiendo" : "sin pantalla"}</span>
      </div>
      {!stream && (
        <button className="btn" onClick={startShare}>Compartir pantalla</button>
      )}
      <input
        className="field"
        placeholder="Opcional: ¿qué te interesa? (ej. over de Dak)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button className="btn primary big" disabled={busy || !stream} onClick={analyzeScreen}>
        {busy ? "Analizando…" : "🔍 Analizar"}
      </button>
      {busy && <Loading text="Leyendo la pantalla y buscando estadísticas (1-2 min)…" />}
      {error && <div className="err small">{error}</div>}
      {result && !busy && <AnalysisView a={result} compact />}
    </div>
  );

  const leagues = LEAGUES.filter((l) => l.sport === sport);

  return (
    <div className="wrap">
      <div className="top">
        <div className="brand">Pronósticos <span>IA</span></div>
        <div className="tabs">
          <button className={`btn ${tab === "partidos" ? "on" : ""}`} onClick={() => setTab("partidos")}>Partidos</button>
          <button className={`btn ${tab === "parlay" ? "on" : ""}`} onClick={() => setTab("parlay")}>
            Armar parlay{legs.length > 0 ? ` (${legs.length})` : ""}
          </button>
          <button className={`btn ${tab === "pantalla" ? "on" : ""}`} onClick={() => setTab("pantalla")}>Ventana flotante</button>
        </div>
      </div>

      <div className="grid">
        {tab !== "pantalla" ? (
          <div className="stack">
            <div className="card">
              <div className="chips">
                {SPORTS.map((s) => (
                  <button key={s.id} className={`btn ${sport === s.id ? "on" : ""}`} onClick={() => setSport(s.id)}>{s.label}</button>
                ))}
              </div>
              <select className="field" value={league} onChange={(e) => setLeague(e.target.value)}>
                {leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>

            <div className="card">
              <h2>Próximos partidos</h2>
              {tab === "parlay" && (
                <div className="small muted" style={{ marginBottom: 8 }}>
                  Toca un partido para agregarlo al boleto. Puedes cambiar de deporte y liga y seguir agregando.
                </div>
              )}
              {gamesLoading && <Loading text="Cargando partidos…" />}
              {gamesError && <div className="err small">{gamesError}</div>}
              {!gamesLoading && !gamesError && games.length === 0 && <div className="muted">No hay partidos en los próximos 7 días.</div>}
              <div className="games">
                {games.map((g) => {
                  const inParlay = legIds.has(g.id);
                  const isSel = tab === "parlay" ? inParlay : selected?.id === g.id;
                  return (
                    <div
                      key={g.id}
                      role="button"
                      tabIndex={0}
                      className={`game ${isSel ? "sel" : ""}`}
                      onClick={() => (tab === "parlay" ? toggleLeg(g) : setSelected(g))}
                      onKeyDown={(e) => e.key === "Enter" && (tab === "parlay" ? toggleLeg(g) : setSelected(g))}
                    >
                      <div className="stack" style={{ gap: 4 }}>
                        <div className="team">{g.away.logo && <img src={g.away.logo} alt="" />}<b>{g.away.name}</b><span className="small muted">{g.away.record}</span></div>
                        <div className="team">{g.home.logo && <img src={g.home.logo} alt="" />}<b>{g.home.name}</b><span className="small muted">{g.home.record}</span></div>
                      </div>
                      <div className="odds">
                        <div>{g.state === "pre" ? fmtDate(g.date) : `${g.status} ${g.score}`}</div>
                        {g.odds.details && <div>{g.odds.details}</div>}
                        {g.odds.overUnder != null && <div>O/U {g.odds.overUnder}</div>}
                        {g.state === "pre" && (
                          <button
                            className={`mini ${inParlay ? "on" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleLeg(g);
                            }}
                          >
                            {inParlay ? "✓ En parlay" : "+ Parlay"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="card stack">
            <h2>Analizar la pantalla de tu casa de apuestas</h2>
            <ol className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
              <li>Abre tu casa de apuestas o quiniela en otra pestaña.</li>
              <li>Pulsa <b>Compartir pantalla</b> y elige <b>esa pestaña</b> (así la ventana flotante no tapa la captura).</li>
              <li>Pulsa <b>Abrir ventana flotante</b>: queda encima de todo. Ve al partido o jugador y dale <b>Analizar</b>.</li>
            </ol>
            <div className="row">
              {stream ? (
                <button className="btn danger" onClick={stopShare}>Dejar de compartir</button>
              ) : (
                <button className="btn primary" onClick={startShare}>Compartir pantalla</button>
              )}
              <button className="btn" onClick={openFloat}>{pip ? "Ventana abierta" : "Abrir ventana flotante"}</button>
            </div>
            {stream ? <video ref={videoRef} className="preview" autoPlay muted playsInline /> : <div className="muted small">Aún no compartes ninguna pantalla.</div>}
            <input className="field" placeholder="Opcional: ¿qué te interesa? (ej. ¿Dak Prescott pasa de 250.5 yardas?)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn primary big" disabled={busy || !stream} onClick={analyzeScreen}>{busy ? "Analizando…" : "🔍 Analizar lo que se ve"}</button>
          </div>
        )}

        {tab === "parlay" ? (
          <div className="stack">
            <div className="card stack">
              <div className="row">
                <h2 style={{ margin: 0 }}>Boleto ({legs.length}/{MAX_PARLAY_GAMES})</h2>
                {legs.length > 0 && (
                  <button className="btn" style={{ marginLeft: "auto" }} onClick={() => { saveLegs([]); setParlayData(null); }}>
                    Vaciar
                  </button>
                )}
              </div>
              {legs.length === 0 && <div className="muted small">Agrega partidos de cualquier deporte con “+ Parlay”.</div>}
              {legs.map((l) => (
                <div key={l.id} className="leg">
                  <div style={{ minWidth: 0 }}>
                    <div className="small muted">{l.leagueName} · {fmtDate(l.date)}</div>
                    <b>{l.away.name} vs {l.home.name}</b>
                  </div>
                  <button className="x" aria-label="Quitar" onClick={() => toggleLeg(l)}>×</button>
                </div>
              ))}
              <div className="row small">
                <span>Parlays de</span>
                <select className="field" style={{ width: "auto" }} value={minLegs} onChange={(e) => { const v = +e.target.value; setMinLegs(v); if (v > maxLegs) setMaxLegs(v); }}>
                  {TAMANOS.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <span>a</span>
                <select className="field" style={{ width: "auto" }} value={maxLegs} onChange={(e) => { const v = +e.target.value; setMaxLegs(v); if (v < minLegs) setMinLegs(v); }}>
                  {TAMANOS.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <span>apuestas</span>
              </div>
              <details open={legs.length > 0}>
                <summary className="small muted" style={{ cursor: "pointer", marginBottom: 8 }}>Mercados a analizar</summary>
                <MarketPicker
                  sports={legs.length ? [...new Set(legs.map((l) => l.sport))] : ["americano", "soccer", "basquet"]}
                  value={mercados}
                  onChange={saveMercados}
                />
              </details>
              <label className="check small">
                <input type="checkbox" checked={sameGame} onChange={(e) => setSameGame(e.target.checked)} />
                Permitir varias apuestas del mismo partido (ej. Cowboys ganan + Dak más de 224.5 yardas)
              </label>
              {legs.length > 0 && legs.length < maxLegs && (
                <div className="small muted">
                  {sameGame
                    ? legs.length === 1
                      ? `Parlay de un solo partido: la IA combinará de 2 a ${comboMaxSize(1, maxLegs)} apuestas de este partido (goles, tarjetas, córners…).`
                      : `Con ${legs.length} partidos, para llegar a ${maxLegs} apuestas se usarán combinadas del mismo partido.`
                    : `Con ${legs.length} partidos el parlay más grande será de ${legs.length}.`}
                </div>
              )}
              <button className="btn primary big" disabled={parlayBusy || legs.length < minGames} onClick={armarParlay}>
                {parlayBusy ? "Analizando partidos…" : legs.length < minGames ? (sameGame ? "Agrega al menos 1 partido" : "Agrega al menos 2 partidos") : "🎯 Armar parlay"}
              </button>
            </div>

            <div className="card">
              {parlayBusy && <Loading text={`La IA está analizando ${legs.length} partidos (${legs.length > 8 ? "3-6" : "1-3"} min)…`} />}
              {parlayError && !parlayBusy && <div className="err small">{parlayError}</div>}
              {!parlayBusy && pendingLegs > 0 && (
                <div className="warn small" style={{ marginBottom: 10 }}>
                  Agregaste {pendingLegs} partido(s) después del análisis. Dale “Armar parlay” otra vez para incluirlos.
                </div>
              )}
              {!parlayBusy && parlayData && (
                parlays.length > 0 ? (
                  <ParlayView parlays={parlays} juegos={analyzedJuegos} advertencias={parlayData.advertencias} fuentes={parlayData.fuentes} />
                ) : (
                  <div className="muted">No hay combinaciones para ese rango. Prueba otro rango o dale “Armar parlay” otra vez para que la IA arme combinadas de ese tamaño.</div>
                )
              )}
              {!parlayBusy && !parlayData && !parlayError && (
                <div className="muted">Aquí aparecerán los parlays con su probabilidad de acertar y lo que pagan.</div>
              )}
            </div>
          </div>
        ) : (
        <div className="stack">
          {tab === "partidos" && (
            <div className="card stack">
              <h2>{selected ? `${selected.away.name} vs ${selected.home.name}` : "Pregunta a la IA"}</h2>
              <textarea
                className="field"
                placeholder={selected
                  ? "Opcional: algo específico (ej. ¿Dak Prescott pasa de 250.5 yardas? ¿Gana por más de 3?)"
                  : "Elige un partido de la lista o pregunta directo: ¿Dak Prescott pasa de 250 yardas el domingo?"}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
              {selected && (
                <details open>
                  <summary className="small muted" style={{ cursor: "pointer", marginBottom: 8 }}>Mercados a analizar</summary>
                  <MarketPicker sports={[selected.sport]} value={mercados} onChange={saveMercados} />
                </details>
              )}
              <div className="row">
                <button
                  className="btn primary"
                  disabled={busy || (!selected && !question.trim())}
                  onClick={() => run({ game: selected ?? undefined, question, mercados })}
                >
                  {busy ? "Analizando…" : "Pronosticar"}
                </button>
                {selected && <button className="btn" onClick={() => setSelected(null)}>Quitar partido</button>}
              </div>
            </div>
          )}

          <div className="card">
            {busy && <Loading text="La IA está buscando lesiones, estadísticas y momios (1-2 min)…" />}
            {error && !busy && <div className="err small">{error}</div>}
            {!busy && result && <AnalysisView a={result} />}
            {!busy && !result && !error && <div className="muted">Aquí aparecerá el pronóstico con su probabilidad y las razones.</div>}
          </div>

          {history.length > 1 && (
            <div className="card">
              <h2>Análisis anteriores</h2>
              <div className="stack small">
                {history.slice(1).map((h, i) => (
                  <button key={i} className="game" onClick={() => setResult(h)}>
                    <span>{h.titulo}</span>
                    <span className="muted">{h.picks[0] ? `${h.picks[0].seleccion} ${h.picks[0].probabilidad}%` : ""}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        )}
      </div>

      <div className="disclaimer">
        Las probabilidades son estimaciones, no garantías. Apuesta solo lo que puedas perder. +18.
      </div>

      {pip && createPortal(floatPanel, pip.document.body)}
    </div>
  );
}
