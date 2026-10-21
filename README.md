# Pronósticos IA

Web app de pronósticos con IA para más de 30 deportes y eventos. Con calendario automático de ESPN: fútbol (20 ligas), NFL/NCAA/CFL/UFL, MLB, NBA/WNBA/NCAA/FIBA, tenis ATP/WTA, NHL, UFC/PFL, F1/NASCAR/IndyCar, golf PGA/LPGA, rugby, NRL, AFL, voleibol, lacrosse y hockey sobre césped. El resto (box, eSports, snooker, dardos, caballos, galgos, ciclismo, política, etc.) se agrega como evento manual y la IA lo investiga en la web.

- **Partidos**: elige deporte y liga, ve los próximos partidos con momios (ESPN, sin llave) y pide el pronóstico. Puedes preguntar algo específico: "¿Dak Prescott pasa de 250.5 yardas?".
- **Ventana flotante**: comparte la pestaña de tu casa de apuestas o quiniela, abre la ventana flotante (queda encima de todo) y pulsa **Analizar**. La IA lee la captura, busca lesiones y estadísticas actuales en la web y te da probabilidad, valor contra el momio y razones.
- **Armar parlay**: agrega partidos de cualquier deporte al boleto (hasta 20), elige un rango de 2 a 20 apuestas y la IA arma los parlays "Más probable" y "Mejor valor" con su probabilidad de acertar, momio combinado y pago. Puede usar varias apuestas del mismo partido (ej. Cowboys ganan + Dak más de 224.5 yardas) con su probabilidad conjunta.
- **Mercados a elegir**: en el análisis de un partido y en el parlay escoges qué mercados considerar: córners, tarjetas, faltas, tiros, goleador, goles de campo, yardas, props de NBA, etc.
- **Datos reales**: antes de llamar a la IA se bajan los box scores de los últimos 5 partidos de cada equipo desde ESPN (córners, faltas, tarjetas, goles de campo, yardas y números de jugadores) y se le pasan como datos verificados.
- **Caché compartido**: cada análisis se guarda en Supabase y se reutiliza para cualquier usuario mientras siga vigente (12 h si faltan más de 2 días, 3 h si faltan más de 6 h, 45 min cerca del partido). En parlays se guarda por partido.
- **Inicio de sesión** con Supabase Auth y límite diario de análisis de IA por usuario (`DAILY_AI_LIMIT`, lo que sale del caché no cuenta; los admins no tienen límite).
- **Efectividad** (pública, en `/efectividad`): cada pick se guarda una vez y se califica solo cuando acaba el partido (ESPN + IA, o búsqueda web en eventos sin ESPN). Muestra acierto contra lo esperado, ROI, calibración, por deporte y por mercado, con filtros por deporte, liga y estado.

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

## Supabase

1. Crea un proyecto en supabase.com.
2. SQL Editor → pega `supabase/schema.sql` completo → Run.
3. Authentication → URL Configuration: pon tu dominio de Vercel en *Site URL* y en *Redirect URLs* (y `http://localhost:3000` para pruebas).
4. Project Settings → API: copia la URL, la *publishable key* y la *secret key* a las variables de entorno.
5. Regístrate en la app y hazte admin: `update public.profiles set is_admin = true where email = tu@correo.com;`

## Deploy en Vercel

Agrega en Settings → Environment Variables todas las de `.env.example` (`ANTHROPIC_API_KEY`, `PB_SUPABASE_URL`, `PB_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `CRON_SECRET`, opcionales `AI_EFFORT` y `DAILY_AI_LIMIT`). Los análisis tienen tope de 300 s por solicitud.

La calificación corre con Vercel Cron una vez al día (límite del plan Hobby; ver `vercel.json`). Para calificar más seguido, un admin puede usar "Calificar ahora" en Efectividad, o un cron externo (p. ej. cron-job.org) puede llamar cada hora `GET /api/cron/calificar` con el encabezado `Authorization: Bearer <CRON_SECRET>`.
