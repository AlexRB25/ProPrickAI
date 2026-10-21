import type { Analysis } from "@/lib/ai";

export function AnalysisView({ a, compact = false }: { a: Analysis; compact?: boolean }) {
  return (
    <div className="result stack">
      <div>
        <h3>{a.titulo}</h3>
        <div>{a.resumen}</div>
      </div>

      {a.picks.map((p, i) => {
        const level = p.probabilidad >= 60 ? "" : p.probabilidad >= 52 ? "mid" : "low";
        const valueCls = p.valor === "a favor" ? "good" : p.valor === "en contra" ? "bad" : "";
        return (
          <div className="pick" key={i}>
            <div className="pick-head">
              <div>
                <div className="small muted">{p.mercado}</div>
                <div className="pick-sel">{p.seleccion}</div>
              </div>
              <div className="pct">{p.probabilidad}%</div>
            </div>
            <div className={`bar ${level}`}><i style={{ width: `${p.probabilidad}%` }} /></div>
            <div className="row small">
              <span className="tag">Confianza {p.confianza}</span>
              {p.cuota && <span className="tag">Momio {p.cuota}</span>}
              {p.probabilidad_implicita != null && <span className="tag">Casa: {p.probabilidad_implicita}%</span>}
              <span className={`tag ${valueCls}`}>Valor: {p.valor}</span>
            </div>
            {p.razones.length > 0 && (
              <ul className="reasons small">
                {(compact ? p.razones.slice(0, 3) : p.razones).map((r, j) => <li key={j}>{r}</li>)}
              </ul>
            )}
          </div>
        );
      })}

      {!compact && a.datos_clave.length > 0 && (
        <div>
          <b className="small">Datos clave</b>
          <ul className="reasons small">{a.datos_clave.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </div>
      )}

      {a.advertencias.length > 0 && (
        <div className="warn small">
          {a.advertencias.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}

      {!compact && a.fuentes.length > 0 && (
        <details className="small">
          <summary className="muted">Fuentes consultadas ({a.fuentes.length})</summary>
          <ul className="reasons">
            {a.fuentes.map((f) => (
              <li key={f.url}><a href={f.url} target="_blank" rel="noreferrer">{f.title}</a></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
