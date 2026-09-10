# CardioSim Pro & DESA — Simulador ECG y Entrenamiento DESA

PWA didáctica para formación en reconocimiento de ritmos ECG y algoritmo DESA
(ERC/AHA). Funciona 100% offline una vez instalada/cargada la primera vez.

Repositorio: `jaacos/Simulador-EKG-DESA`.

## Qué incluye

- **Monitor multiparamétrico simulado**: ECG (derivación II), pletismografía
  de SpO₂, respiración, frecuencia cardíaca medida latido a latido, SpO₂,
  presión arterial no invasiva (con ciclo de medición periódico) y frecuencia
  respiratoria. El pulso/SpO₂/TA se muestran como no válidos cuando el ritmo
  no genera pulso (FV, TVSP, torsades, asistolia, AESP) — es el punto
  didáctico clave de la AESP: el monitor puede mostrar un trazado organizado
  sin que haya circulación real.
- **13 ritmos** con morfología generada matemáticamente (no son vídeos ni
  imágenes pregrabadas): sinusal normal, bradicardia sinusal, taquicardia
  sinusal, fibrilación auricular, flutter auricular, bloqueo AV completo,
  TV con pulso, TV sin pulso, FV gruesa, FV fina, torsade de pointes,
  asistolia y AESP. Ver `src/rhythms.js`.
- **Motor de tiempo unificado**: un único acumulador de tiempo real gobierna
  a la vez el avance del puntero de barrido en pantalla y la fase del ciclo
  cardíaco (ver `RhythmEngine.advance` en `src/rhythms.js` y `_advanceSweep`
  en `src/app.js`). Esto es deliberado: cualquier implementación que mueva el
  puntero con un contador de píxeles fijo por *frame* y la onda con un reloj
  de tiempo real independiente acaba desincronizándose en framerates
  variables (pestaña en segundo plano, tablets lentas, pantallas a 120 Hz).
  Aquí ambos derivan de la misma variable, así que no pueden desincronizarse.
- **Algoritmo DESA con ciclos de RCP reales**: Analizar → (descarga o no) →
  ciclo de RCP de 2 minutos (comprimido para ritmo de aula, con botón para
  saltarlo) → nuevo análisis. La descarga tiene un 70% de probabilidad de
  convertir el ritmo — no siempre funciona a la primera, deliberadamente,
  para reforzar el mensaje de "seguid con RCP aunque hayáis descargado".
  Caso especial: la TV **con pulso** en paciente consciente se trata
  explícitamente como "no es una parada cardiorrespiratoria" — el DESA no
  debe aplicarse aunque el QRS sea ancho, un matiz real del algoritmo que
  muchos simuladores pasan por alto.
- **Modo Reto Alumno**: identifica el ritmo mostrado y decide si el DESA
  debe descargar. El indicador de "desfibrilable/no desfibrilable" se oculta
  en este modo para no desvelar la respuesta, y el botón de "Analizar Ritmo"
  del monitor permanece bloqueado hasta que el alumno confirma su decisión
  (para no dar la respuesta antes de tiempo). Puntuación de sesión (no
  persiste entre recargas — ver Limitaciones).
- **PWA real**: manifest, Service Worker con precaché offline
  (`vite-plugin-pwa`), iconos, instalable en escritorio/móvil.
- **Sin CDN en producción**: Tailwind se compila localmente (no se carga
  desde `cdn.tailwindcss.com`) y las fuentes (Inter, Chakra Petch, Share
  Tech Mono) están autoalojadas vía [Fontsource](https://fontsource.org/) —
  imprescindible para que funcione sin conexión en el aula.

## Icono / branding

Los iconos de `public/icons/` son un **placeholder genérico** (trazo ECG
verde sobre fondo oscuro), generados desde `public/favicon.svg` mediante
`scripts/gen-icons.mjs`. En cuanto tengas logo/paleta institucional
definitivos, sustituye `public/favicon.svg` y ejecuta `npm run gen-icons`.

## Activar el despliegue en GitHub Pages

1. En el repo: **Settings → Pages → Source → GitHub Actions.**
2. Haz push a `main` (o usa "Run workflow" en la pestaña Actions). El
   workflow en `.github/workflows/deploy.yml` instala dependencias, compila
   con Vite y publica `dist/` en Pages automáticamente.
3. La URL final será `https://jaacos.github.io/Simulador-EKG-DESA/`.

`vite.config.js` tiene una constante `REPO_NAME` que debe coincidir
**exactamente** con el nombre del repositorio en GitHub (ya está puesto a
`Simulador-EKG-DESA`). Si renombras el repo, actualiza esa constante antes
de la siguiente build o los assets y el manifest de la PWA no cargarán.

## Desarrollo local

```bash
npm install
npm run dev        # servidor local con recarga en caliente
npm run build       # build de producción en dist/ (lo mismo que hace el Action)
npm run preview     # sirve dist/ localmente para probar el resultado final
npm run gen-icons   # regenera los PNG de public/icons/ desde favicon.svg
```

## Limitaciones conocidas y honestas

- **Web Speech API (voz del DESA)**: no suena igual —o directamente no
  suena— en todos los navegadores/SO, especialmente Safari/iOS. Está tratada
  como refuerzo, nunca como la única fuente de la instrucción: el texto en
  pantalla del banner del DESA (`desaVoiceText` / `desaGuidanceSubtext`) es
  siempre la referencia real. No diseñes ninguna evaluación que dependa de
  que el alumno *oiga* algo que solo aparece en audio.
- **Firefox de escritorio no soporta instalación de PWA** de forma nativa —
  funcionará como página web normal, sin el símbolo de "instalar app", pero
  seguirá cacheándose offline igual mientras esté abierta la pestaña.
- **La puntuación del Reto Alumno no persiste** entre recargas de página ni
  entre sesiones — es una decisión deliberada para no añadir alcance no
  pedido; si te interesa (localStorage, ranking por alumno, exportar
  resultados...) es una mejora razonable pero no está incluida.
- **Los valores de tensión arterial (NIBP), SpO₂ y frecuencia respiratoria
  son aproximaciones fisiológicas plausibles**, no un modelo hemodinámico
  real — suficientes para el objetivo didáctico (reconocer el patrón y la
  conducta correcta), no para validar cifras exactas.
- **Los ciclos de RCP entre análisis del DESA están comprimidos a ~24 s**
  reales (en vez de los 2 minutos reales del algoritmo ERC/AHA) para que la
  demo sea ágil en clase; hay un botón "Saltar espera" visible durante la
  espera. Si prefieres el tiempo real de 2 minutos, cambia
  `CPR_CYCLE_SECONDS` en `src/app.js`.
