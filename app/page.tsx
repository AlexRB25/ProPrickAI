"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LEAGUES, leaguesOf, manualGame, SPORTS, sportInfo, type Game, type Sport } from "@/lib/espn";
import type { Analysis, CacheInfo } from "@/lib/ai";
import { authFetch, supabase } from "@/lib/supabase-browser";
import { LoginModal, useSession } from "./Auth";
import { useAccount } from "./useAccount";

// Error con enlace a Planes cuando falta suscripción o créditos.
function PayError({ text }: { text: string }) {
  const pago = /suscripci|créditos/i.test(text);
  return (
    <div className="err small">
      {text}
      {pago && (
        <>
          {" "}
          <a href="/planes">Ver planes →</a>
        </>
      )}
    </div>
  );
}
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


const HISTORY_KEY = "pronosticos-historial";
const PARLAY_KEY = "pronosticos-parlay";
const MARKETS_KEY = "pronosticos-mercados";
const MANUAL_KEY = "pronosticos-eventos";

// Boletos guardados por versiones anteriores no traen title/kind.
const normalize = (g: Game): Game => ({ ...g, kind: g.kind ?? "match", title: g.title ?? `${g.away.name} vs ${g.home.name}` });
const MAX_PARLAY_GAMES = 20;
const TAMANOS = Array.from({ length: MAX_APUESTAS - 1 }, (_, i) => i + 2);

interface ParlayData {
  cache?: CacheInfo;
  restantes?: number | null;
  juegos: GameOptions[];
  advertencias: string[];
  fuentes: { title: string; url: string }[];
}

type AnalyzeBody = { image?: string; game?: Game; question?: string; mercados?: MarketSelection; refresh?: boolean };

class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function requestAnalysis(body: AnalyzeBody): Promise<Analysis> {
  const res = await authFetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: `Error ${res.status}` }));
  if (!res.ok) throw new HttpError(data.error ?? `Error ${res.status}`, res.status);
  return data;
}

function hace(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return `hace ${h} h`;
}

function CacheBadge({ cache, restantes, onRefresh }: { cache?: CacheInfo; restantes?: number | null; onRefresh: () => void }) {
  if (!cache) return null;
  const parlay = cache.nuevos != null;
  const text = parlay
    ? cache.nuevos === 0
      ? `⚡ Todo salió del caché compartido (analizado ${hace(cache.creado)})`
      : cache.deCache
        ? `⚡ ${cache.deCache} partido(s) del caché · 🆕 ${cache.nuevos} analizado(s) ahora`
        : "🆕 Análisis nuevo"
    : cache.hit
      ? `⚡ Del caché compartido · analizado ${hace(cache.creado)}`
      : "🆕 Análisis nuevo";
  return (
    <div className="row small muted" style={{ marginBottom: 10 }}>
      <span>{text}</span>
      {restantes !== undefined && <span>· {restantes === null ? "admin: sin costo" : `te quedan ${restantes} créditos`}</span>}
      {(cache.hit || (parlay && cache.deCache)) && (
        <button className="link" style={{ marginLeft: "auto" }} onClick={onRefresh}>Actualizar análisis</button>
      )}
    </div>
  );
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
  const { session, recovery, endRecovery } = useSession();
  const { account, setCredits } = useAccount(session);
  const tarifas = account?.tarifas;
  const [loginOpen, setLoginOpen] = useState(false);
  const lastBody = useRef<AnalyzeBody | null>(null);

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
  const [sport, setSport] = useState<Sport>("soccer");
  const [manualEvents, setManualEvents] = useState<Game[]>([]);
  const [mEvento, setMEvento] = useState("");
  const [mTorneo, setMTorneo] = useState("");
  const [mFecha, setMFecha] = useState("");
  const [mNotas, setMNotas] = useState("");
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
      if (savedLegs) setLegs((JSON.parse(savedLegs) as Game[]).map(normalize));
      const savedManual = localStorage.getItem(MANUAL_KEY);
      if (savedManual) setManualEvents(JSON.parse(savedManual));
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

  async function armarParlay(refresh = false) {
    if (!session) {
      setLoginOpen(true);
      return;
    }
    setParlayBusy(true);
    setParlayError("");
    try {
      const res = await authFetch("/api/parlay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ games: legs, mercados, sameGame, minLegs, maxLegs, refresh }),
      });
      const data = await res.json().catch(() => ({ error: `Error ${res.status}` }));
      if (res.status === 401) setLoginOpen(true);
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setParlayData(data);
      setCredits(data.restantes);
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
    if (l?.sport !== sport) setLeague(leaguesOf(sport)[0]?.id ?? "");
  }, [sport, league]);

  useEffect(() => {
    let cancel = false;
    if (!league) {
      setGames([]);
      setGamesError("");
      setGamesLoading(false);
      return;
    }
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

  const run = useCallback(async (body: AnalyzeBody) => {
    if (!session) {
      setLoginOpen(true);
      return;
    }
    lastBody.current = { ...body, refresh: false };
    setBusy(true);
    setError("");
    try {
      const a = await requestAnalysis(body);
      setResult(a);
      setCredits(a.restantes);
      setHistory((h) => {
        const next = [a, ...h].slice(0, 15);
        try {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) setLoginOpen(true);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [session]);

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
        {busy ? "Analizando…" : `🔍 Analizar${tarifas ? ` · ${tarifas.captura} créditos` : ""}`}
      </button>
      {busy && <Loading text="Leyendo la pantalla y buscando estadísticas (1-2 min)…" />}
      {error && <PayError text={error} />}
      {result && !busy && <AnalysisView a={result} compact />}
    </div>
  );

  const leagues = leaguesOf(sport);
  const shownGames = [...manualEvents.filter((g) => g.sport === sport), ...games];

  function saveManual(next: Game[]) {
    setManualEvents(next);
    try {
      localStorage.setItem(MANUAL_KEY, JSON.stringify(next));
    } catch {}
  }

  function addManual() {
    if (!mEvento.trim()) return;
    const g = manualGame(sport, mEvento.slice(0, 200), mTorneo.slice(0, 150), mFecha, mNotas);
    saveManual([g, ...manualEvents].slice(0, 50));
    setMEvento("");
    setMNotas("");
    if (tab === "parlay") toggleLeg(g);
    else setSelected(g);
  }

  function removeManual(g: Game) {
    saveManual(manualEvents.filter((x) => x.id !== g.id));
    if (legIds.has(g.id)) toggleLeg(g);
    if (selected?.id === g.id) setSelected(null);
  }

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
          <a className="btn" href="/apuestas">🗳️ Apuestas</a>
          <a className="btn" href="/efectividad">📊 Efectividad</a>
          <a className="btn" href="/planes">{account?.user ? (account.user.isAdmin ? "💎 Admin" : `💎 ${account.user.credits} créditos`) : "💎 Planes"}</a>
          {account?.user?.isAdmin && <a className="btn" href="/admin">⚙️ Panel</a>}
          {session ? (
            <button className="btn" title={session.user.email ?? ""} onClick={() => supabase().auth.signOut()}>Salir</button>
          ) : (
            <button className="btn primary" onClick={() => setLoginOpen(true)}>Entrar</button>
          )}
        </div>
      </div>

      <div className="grid">
        {tab !== "pantalla" ? (
          <div className="stack">
            <div className="card">
              <div className="sports">
                {SPORTS.map((s) => (
                  <button key={s.id} className={`sport ${sport === s.id ? "on" : ""}`} onClick={() => setSport(s.id)}>
                    <span>{s.emoji}</span> {s.label}
                  </button>
                ))}
              </div>
              {leagues.length > 0 ? (
                <select className="field" value={league} onChange={(e) => setLeague(e.target.value)}>
                  {leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              ) : (
                <div className="small muted">
                  No hay calendario automático de {sportInfo(sport).label}. Escribe el evento abajo y la IA lo investiga en la web.
                </div>
              )}
              <details open={leagues.length === 0} style={{ marginTop: 10 }}>
                <summary className="small muted" style={{ cursor: "pointer" }}>+ Agregar evento manual</summary>
                <div className="stack" style={{ marginTop: 8, gap: 8 }}>
                  <input
                    className="field"
                    placeholder={sport === "box" ? "Ej. Canelo Álvarez vs Terence Crawford" : sport === "caballos" || sport === "motor" || sport === "golf" ? "Ej. Kentucky Derby (o nombre de la carrera/torneo)" : sport === "politica" ? "Ej. Elección presidencial de Brasil 2026" : "Ej. Equipo A vs Equipo B"}
                    value={mEvento}
                    onChange={(e) => setMEvento(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addManual()}
                  />
                  <div className="row">
                    <input className="field" placeholder="Torneo o liga (opcional)" value={mTorneo} onChange={(e) => setMTorneo(e.target.value)} />
                    <input className="field" type="datetime-local" style={{ width: "auto", minWidth: 0, maxWidth: "100%" }} value={mFecha} onChange={(e) => setMFecha(e.target.value)} />
                  </div>
                  <input className="field" placeholder="Momios o líneas que viste (opcional)" value={mNotas} onChange={(e) => setMNotas(e.target.value)} />
                  <button className="btn primary" disabled={!mEvento.trim()} onClick={addManual}>
                    {tab === "parlay" ? "Agregar al boleto" : "Agregar y analizar"}
                  </button>
                </div>
              </details>
            </div>

            <div className="card">
              <h2>Próximos eventos</h2>
              {tab === "parlay" && (
                <div className="small muted" style={{ marginBottom: 8 }}>
                  Toca un partido para agregarlo al boleto. Puedes cambiar de deporte y liga y seguir agregando.
                </div>
              )}
              {gamesLoading && <Loading text="Cargando partidos…" />}
              {gamesError && <div className="err small">{gamesError}</div>}
              {!gamesLoading && !gamesError && shownGames.length === 0 && <div className="muted">{league ? "No hay eventos en los próximos 7 días." : "Agrega un evento arriba para analizarlo."}</div>}
              <div className="games">
                {shownGames.map((g) => {
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
                      {g.kind === "field" ? (
                        <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                          <div className="team"><b>{g.title}</b></div>
                          <div className="small muted">
                            {g.manual ? `${g.leagueName} · evento manual` : `${g.leagueName} · ${g.field?.length ? `${g.field.length} participantes` : "participantes por confirmar"}`}
                          </div>
                        </div>
                      ) : (
                        <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                          <div className="team">{g.away.logo && <img src={g.away.logo} alt="" />}<b>{g.away.name}</b><span className="small muted">{g.away.record}</span></div>
                          <div className="team">{g.home.logo && <img src={g.home.logo} alt="" />}<b>{g.home.name}</b><span className="small muted">{g.home.record}</span></div>
                          {(g.manual || g.leagueName.includes("·")) && (
                            <div className="small muted">{g.manual ? `${g.leagueName} · evento manual` : g.leagueName.split(" · ").slice(1).join(" · ")}{g.status && !g.manual ? ` · ${g.status}` : ""}</div>
                          )}
                        </div>
                      )}
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
                        {g.manual && (
                          <button
                            className="x"
                            style={{ marginTop: 6, width: 24, height: 24, fontSize: 14 }}
                            aria-label="Borrar evento"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeManual(g);
                            }}
                          >
                            ×
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
                    <b>{sportInfo(l.sport).emoji} {l.title}</b>
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
              <button className="btn primary big" disabled={parlayBusy || legs.length < minGames} onClick={() => armarParlay()}>
                {parlayBusy ? "Analizando partidos…" : legs.length < minGames ? (sameGame ? "Agrega al menos 1 partido" : "Agrega al menos 2 partidos") : "🎯 Armar parlay"}
              </button>
              {tarifas && legs.length >= minGames && (
                <div className="small muted">
                  Hasta {legs.length * tarifas.parlay_partido} créditos ({tarifas.parlay_partido} por partido nuevo, {tarifas.parlay_cache} si ya está en caché)
                </div>
              )}
            </div>

            <div className="card">
              {parlayBusy && <Loading text={`La IA está analizando ${legs.length} partidos (${legs.length > 8 ? "3-6" : "1-3"} min)…`} />}
              {parlayError && !parlayBusy && <PayError text={parlayError} />}
              {!parlayBusy && pendingLegs > 0 && (
                <div className="warn small" style={{ marginBottom: 10 }}>
                  Agregaste {pendingLegs} partido(s) después del análisis. Dale “Armar parlay” otra vez para incluirlos.
                </div>
              )}
              {!parlayBusy && parlayData && (
                parlays.length > 0 ? (
                  <><CacheBadge cache={parlayData.cache} restantes={parlayData.restantes} onRefresh={() => armarParlay(true)} /><ParlayView parlays={parlays} juegos={analyzedJuegos} advertencias={parlayData.advertencias} fuentes={parlayData.fuentes} /></>
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
              <h2>{selected ? selected.title : "Pregunta a la IA"}</h2>
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
              {tarifas && (
                <div className="small muted">
                  {tarifas.analisis} créditos ({tarifas.analisis_cache} si ya está en caché; +{tarifas.analisis_extendido} con más de 3 mercados de estadísticas)
                </div>
              )}
            </div>
          )}

          <div className="card">
            {busy && <Loading text="La IA está buscando lesiones, estadísticas y momios (1-2 min)…" />}
            {error && !busy && <PayError text={error} />}
            {!busy && result && (
              <>
                <CacheBadge cache={result.cache} restantes={result.restantes} onRefresh={() => lastBody.current && run({ ...lastBody.current, refresh: true })} />
                <AnalysisView a={result} />
              </>
            )}
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
      <LoginModal
        open={loginOpen}
        recovery={recovery}
        onClose={() => {
          setLoginOpen(false);
          endRecovery();
        }}
      />
    </div>
  );
}
