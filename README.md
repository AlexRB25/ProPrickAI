# Pronósticos IA

Web app de pronósticos con IA para más de 30 deportes y eventos. Con calendario automático de ESPN: fútbol (20 ligas), NFL/NCAA/CFL/UFL, MLB, NBA/WNBA/NCAA/FIBA, tenis ATP/WTA, NHL, UFC/PFL, F1/NASCAR/IndyCar, golf PGA/LPGA, rugby, NRL, AFL, voleibol, lacrosse y hockey sobre césped. El resto (box, eSports, snooker, dardos, caballos, galgos, ciclismo, política, etc.) se agrega como evento manual y la IA lo investiga en la web.

- **Partidos**: elige deporte y liga, ve los próximos partidos con momios (ESPN, sin llave) y pide el pronóstico. Puedes preguntar algo específico: "¿Dak Prescott pasa de 250.5 yardas?".
- **Ventana flotante**: comparte la pestaña de tu casa de apuestas o quiniela, abre la ventana flotante (queda encima de todo) y pulsa **Analizar**. La IA lee la captura, busca lesiones y estadísticas actuales en la web y te da probabilidad, valor contra el momio y razones.
- **Armar parlay**: agrega partidos de cualquier deporte al boleto (hasta 20), elige un rango de 2 a 20 apuestas y la IA arma los parlays "Más probable" y "Mejor valor" con su probabilidad de acertar, momio combinado y pago. Puede usar varias apuestas del mismo partido (ej. Cowboys ganan + Dak más de 224.5 yardas) con su probabilidad conjunta.
- **Mercados a elegir**: en el análisis de un partido y en el parlay escoges qué mercados considerar: córners, tarjetas, faltas, tiros, goleador, goles de campo, yardas, props de NBA, etc.
- **Datos reales**: antes de llamar a la IA se bajan los box scores de los últimos 5 partidos de cada equipo desde ESPN (córners, faltas, tarjetas, goles de campo, yardas y números de jugadores) y se le pasan como datos verificados.

## Arranque

```bash
npm install
cp .env.example .env.local   # pon tu ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

La ventana flotante usa Document Picture-in-Picture: solo Chrome o Edge de escritorio.
Cada análisis usa Claude Opus 5.5 con búsqueda web; tarda 1-2 minutos y cuesta centavos de dólar.
`AI_EFFORT=high` da análisis más profundos a cambio de más costo y tiempo.

Las probabilidades parten del momio de la casa (sin margen) y solo se mueven con evidencia; no son garantías.

## Deploy en Vercel

Agrega `ANTHROPIC_API_KEY` (y opcional `AI_EFFORT`) en Settings → Environment Variables. Los análisis tienen tope de 300 s por solicitud.
