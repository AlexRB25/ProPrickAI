import { useState } from "react";
import type { GameOptions, Parlay } from "@/lib/parlay";

type Orden = "cantidad" | "probabilidad" | "momio";

const ORDENES: { id: Orden; label: string }[] = [
  { id: "cantidad", label: "Cantidad de apuestas" },
  { id: "probabilidad", label: "Probabilidad ↓" },
  { id: "momio", label: "Momio ↓" },
];

function ordenar(parlays: Parlay[], orden: Orden): Parlay[] {
  if (orden === "cantidad") return parlays;
  const copia = [...parlays];
  if (orden === "probabilidad") return copia.sort((a, b) => b.probabilidad - a.probabilidad);
  // Momio mayor = paga más; los que no tienen momio van al final.
  return copia.sort((a, b) => (b.cuotaDecimal ?? -1) - (a.cuotaDecimal ?? -1));
}

function money(n: number) {
  return `$${n.toLocaleString("es-MX")}`;
}

export function ParlayView({
  parlays,
  juegos,
  advertencias,
  fuentes,
}: {
  parlays: Parlay[];
  juegos: GameOptions[];
  advertencias: string[];
  fuentes: { title: string; url: string }[];
}) {
  const [orden, setOrden] = useState<Orden>("cantidad");
  return (
    <div className="result stack">
      <div className="small muted">
        La probabilidad de un parlay es la multiplicación de sus apuestas: cada pierna que agregas la baja. “Segura” busca la mayor
        probabilidad; “Valor”, lo que más paga en relación con su probabilidad. Cada parlay evita repetir las apuestas de los anteriores para que, si una falla, no se caigan todos. Las apuestas del mismo
        partido traen su probabilidad conjunta, porque se afectan entre sí.
      </div>

      <div className="row small">
        <span className="muted">Ordenar por:</span>
        {ORDENES.map((o) => (
          <button key={o.id} className={`mini ${orden === o.id ? "on" : ""}`} style={{ marginTop: 0 }} onClick={() => setOrden(o.id)}>
            {o.label}
          </button>
        ))}
      </div>

      {ordenar(parlays, orden).map((p, i) => {
        const level = p.probabilidad >= 40 ? "" : p.probabilidad >= 20 ? "mid" : "low";
        return (
          <div className="pick" key={`${p.tipo}-${p.piernas.length}-${i}`}>
            <div className="pick-head">
              <div>
                <div className="small muted">{p.tipo}</div>
                <div className="pick-sel">
                  Parlay de {p.apuestas} apuestas
                  {p.partidos !== p.apuestas && <span className="small muted"> · {p.partidos} partido{p.partidos === 1 ? "" : "s"}</span>}
                </div>
              </div>
              <div className="pct">{p.probabilidad}%</div>
            </div>
            <div className={`bar ${level}`}><i style={{ width: `${Math.max(1, p.probabilidad)}%` }} /></div>
            <div className="row small">
              {p.cuotaAmericana && <span className="tag">Momio {p.cuotaAmericana}{p.cuotaEstimada ? " aprox." : ""}</span>}
              {p.pagoPor100 != null && <span className="tag">Pagas $100 → cobras {money(p.pagoPor100)}</span>}
              {p.valorEsperado != null && (
                <span className={`tag ${p.valorEsperado >= 3 ? "good" : p.valorEsperado <= -3 ? "bad" : ""}`}>
                  Valor esperado {p.valorEsperado >= 0 ? "+" : ""}{p.valorEsperado}%
                </span>
              )}
            </div>
            <ol className="reasons small">
              {p.piernas.map((l) => (
                <li key={l.gameId}>
                  {l.selecciones.length === 1 ? (
                    <>
                      <b>{l.selecciones[0].seleccion}</b> <span className="muted">({l.selecciones[0].mercado}, {l.partido})</span>
                    </>
                  ) : (
                    <>
                      <span className="tag">Mismo partido</span> <span className="muted">{l.partido}</span>
                      <ul className="sgp">
                        {l.selecciones.map((x, k) => <li key={k}><b>{x.seleccion}</b> <span className="muted">({x.mercado})</span></li>)}
                      </ul>
                      <span className="muted">Juntas:</span>
                    </>
                  )}
                  {" "}· {l.probabilidad}%
                  {l.cuota && ` · ${l.cuota}${l.cuota_estimada ? "~" : ""}`}
                  {l.razon && <div className="muted">{l.razon}</div>}
                </li>
              ))}
            </ol>
          </div>
        );
      })}

      <details className="small">
        <summary className="muted">Todas las opciones por partido</summary>
        <div className="stack" style={{ marginTop: 8 }}>
          {juegos.map((j) => (
            <div key={j.id}>
              <b>{j.partido}</b>
              <ul className="reasons">
                {j.opciones.map((o, k) => (
                  <li key={k}>
                    {o.seleccion} <span className="muted">({o.mercado})</span> · {o.probabilidad}%
                    {o.cuota && ` · ${o.cuota}${o.cuota_estimada ? "~" : ""}`}
                    {o.razon && <div className="muted">{o.razon}</div>}
                  </li>
                ))}
                {(j.combinadas ?? []).map((c, k) => (
                  <li key={`c${k}`}>
                    <span className="tag">Mismo partido</span> {c.selecciones.map((x) => x.seleccion).join(" + ")} · {c.probabilidad}% juntas
                    {c.cuota && ` · ${c.cuota}~`}
                    {c.razon && <div className="muted">{c.razon}</div>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>

      {advertencias.length > 0 && (
        <div className="warn small">
          {advertencias.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}

      {fuentes.length > 0 && (
        <details className="small">
          <summary className="muted">Fuentes consultadas ({fuentes.length})</summary>
          <ul className="reasons">
            {fuentes.map((f) => (
              <li key={f.url}><a href={f.url} target="_blank" rel="noreferrer">{f.title}</a></li>
            ))}
          </ul>
        </details>
      )}
      <div className="small muted">~ = momio aproximado. Revisa el momio real en tu casa de apuestas antes de jugar.</div>
    </div>
  );
}
