import type { Sport } from "@/lib/espn";
import { DEFAULT_MARKETS, MARKETS, type MarketSelection } from "@/lib/markets";

const SPORT_LABEL: Record<Sport, string> = {
  americano: "🏈 Fútbol americano",
  soccer: "⚽ Soccer",
  basquet: "🏀 Básquetbol",
};

export function MarketPicker({
  sports,
  value,
  onChange,
}: {
  sports: Sport[];
  value: MarketSelection;
  onChange: (v: MarketSelection) => void;
}) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      {sports.map((sp) => {
        const chosen = value[sp] ?? DEFAULT_MARKETS[sp];
        const set = (ids: string[]) => onChange({ ...value, [sp]: ids });
        const all = MARKETS[sp].map((m) => m.id);
        return (
          <div key={sp}>
            {sports.length > 1 && <div className="small muted" style={{ marginBottom: 4 }}>{SPORT_LABEL[sp]}</div>}
            <div className="row" style={{ gap: 6 }}>
              {MARKETS[sp].map((m) => {
                const on = chosen.includes(m.id);
                return (
                  <button
                    key={m.id}
                    className={`mini ${on ? "on" : ""}`}
                    style={{ marginTop: 0 }}
                    title={m.hint}
                    onClick={() => set(on ? chosen.filter((x) => x !== m.id) : [...chosen, m.id])}
                  >
                    {m.label}
                  </button>
                );
              })}
              <button className="mini" style={{ marginTop: 0, borderColor: "var(--line)", color: "var(--muted)" }} onClick={() => set(chosen.length === all.length ? DEFAULT_MARKETS[sp] : all)}>
                {chosen.length === all.length ? "Básicos" : "Todos"}
              </button>
            </div>
          </div>
        );
      })}
      <div className="small muted">Más mercados = análisis más completo, pero tarda más y cuesta un poco más.</div>
    </div>
  );
}
