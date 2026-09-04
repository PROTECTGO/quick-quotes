/* ============================================================================
 * pg-novedades.js  ·  Widget lector de Novedades ProtectGo  ·  v4.5
 * ----------------------------------------------------------------------------
 * Archivo COMPARTIDO Y DE ALTO ALCANCE. Se carga en el <head> de 13 páginas
 * SIN defer/async:
 *
 *     <script src="https://protectgo.github.io/quick-quotes/pg-novedades.js"></script>
 *
 * Como se ejecuta antes de que exista <body>, este archivo NO toca el DOM en el
 * momento de la definición. Todo acceso al DOM ocurre dentro de funciones que
 * se llaman después (asegurarEstilos, abrirOverlay, etc.).
 *
 * FIRMA PÚBLICA — NO CAMBIA (las 13 páginas no se tocan):
 *     window.pgRevisarNovedades(sbClient, area)
 *     window.pgNovedadesAuto(area)
 *   Novedad del v4: area puede ir en null / vacío (el portal lo usa así).
 *   En ese caso el widget pregunta rpc('novedades_mis_areas') y pide los
 *   pendientes de cada área (o 'general' si la RPC no existe todavía).
 *
 * QUÉ CONSERVA DEL v3.1 (idéntico):
 *   - Tiempo real (postgres_changes) + respaldo de 60 s + visibilitychange/online.
 *   - Bloqueo protegido: banner rojo si hay un formulario a medio llenar.
 *   - Registro de lectura por persona y novedad (marcar_novedad_leida).
 *   - Contador que SOLO avanza con la pestaña visible y con foco, cartel de
 *     pausa, botón deshabilitado hasta cumplir el tiempo y tragado de Escape.
 *   - Arranque automático con cliente de SOLO lectura (no pisa la sesión).
 *   - Bloque "Enseñanza del mes" con acento dorado, tarjeta héroe y confeti.
 *   - Ganchos de diagnóstico __pgnov* y quitarNovedad en caliente.
 *
 * QUÉ CAMBIA EN EL v4.0 (Novedades v2 — El Muro, §3.1 y §3.1-B):
 *   1) Configuración de presentación leída de portal.novedades_config:
 *      tema_overlay ('claro' | 'oscuro'), modo_ronda ('persona' | 'mosaico'),
 *      segundos_por_persona (int | null), reacciones_activas (bool).
 *      Si la consulta falla o las columnas no existen -> claro + persona +
 *      reparto actual. NUNCA revienta por esto.
 *   2) La cola se separa: bloqueante === false NO abre overlay (queda para el
 *      muro del portal). Solo las bloqueantes abren pantalla.
 *   3) Agrupación por lote_id: en modo_ronda='mosaico' las filas del mismo
 *      lote son UNA pantalla con mosaico; en 'persona' (default) cada fila es
 *      su propia pantalla, en orden de created_at.
 *   4) Contador: segundos_por_persona manda si viene; si es null, la regla
 *      vigente (mayor segundos_lectura ÷ nº de pantallas, mínimo 15 s).
 *   5) Tema claro (nuevo, default) con la temática de Renovaciones v27: barra
 *      superior blanca GABI | NOVEDADES · n de N + píldora oscura con el
 *      contador en mono, panel blanco 820 px radio 16, foto 260 px con anillo
 *      menta (o iniciales), confeti sutil. El tema oscuro queda intacto.
 *   6) Pie con reacciones 👏 🎉 ❤️ 🔥 💪 (portal.novedades_reacciones) cuando
 *      el contador libera el botón. Si fallan, quedan inertes: no rompen nada.
 *   7) Enlace "Ver en el portal →" al muro (index.html#muro=<id>).
 *
 * QUÉ CAMBIA EN EL v4.1 (refinamiento visual pedido por Andrés — SOLO CSS y
 * jerarquía tipográfica; cola, contador, lectura, reacciones, Realtime y
 * firma pública quedan intactos):
 *   1) FUERA el verde petróleo #06202A. El tema oscuro pasa a la tinta del
 *      estándar (--ink #1B2D3A) con su degradado 233A4A → 1B2D3A → 152430.
 *      No queda ni un hex verde-petróleo en el archivo.
 *   2) Tema claro (el default) con fondo trabajado en vez de gris plano:
 *      --bg #F4F7FA + lavado blanco radial amplio + halo menta muy tenue
 *      DETRÁS del panel (alfa .10 general / .15 en felicitación, desvaneciendo
 *      a 0: la menta sigue siendo acento, no fondo). En el tema oscuro el
 *      halo equivalente es luz blanca al 5,5 %, sin tinte verde.
 *   3) Jerarquía tipográfica de tres niveles: nombre (Montserrat 800 fluido,
 *      letter-spacing negativo, text-wrap:balance para que no queden viudas),
 *      logro (mayúscula espaciada menta profunda 700, pequeño) y cuerpo
 *      (Inter 400, line-height 1.6, medida ~62 caracteres, text-wrap:pretty).
 *   4) Ritmo vertical con escala 8/12/20/32/48 (--s1..--s5), no márgenes
 *      sueltos.
 *   5) Números SIEMPRE en JetBrains Mono con cifras tabulares: contador,
 *      "n de N" y las cifras de dinero/porcentaje del cuerpo, que se detectan
 *      con expresión regular y se envuelven en <span class="pgnov-num">
 *      usando NODOS DE TEXTO (jamás innerHTML).
 * ==========================================================================*/

(function () {
  'use strict';

  /* Si el archivo se cargó dos veces, no volvemos a definir nada. */
  if (window.PG_NOVEDADES_VERSION) { return; }
  window.PG_NOVEDADES_VERSION = '4.5';

  /* --------------------------------------------------------------------- */
  /* Constantes                                                            */
  /* --------------------------------------------------------------------- */

  var MS_RESPALDO      = 60000;   // paracaídas: revisa cada 60 s por si el socket murió
  var MS_DEBOUNCE      = 800;     // anti-tormenta de eventos realtime
  var MS_BANNER_MAX    = 180000;  // 3 minutos: el banner se convierte en overlay sí o sí
  var MS_VENTANA_ENTRADA = 30000; // llamadas dentro de los primeros 30 s = "acaba de entrar"
  var MS_RESUSCRIBIR   = 8000;    // espera antes de reintentar la suscripción caída
  var MS_TRANSICION    = 260;     // salida de una pantalla antes de pintar la siguiente
  var SEG_MINIMO       = 3;       // piso de lectura por pantalla (Andrés bajó el default a 5 s)
  var SEG_POR_DEFECTO  = 90;      // si la novedad no trae segundos_lectura

  var URL_MURO = 'https://protectgo.github.io/quick-quotes/index.html#muro=';

  /* Reacciones fijas (decisión de Andrés, §1.5). Aquí el emoji ES CONTENIDO,
     no icono de interfaz: por eso está permitido por el estándar visual. */
  var EMOJIS = ['👏', '🎉', '❤️', '🔥', '💪'];

  var TIPOS = {
    felicitacion: { c: 'felicitacion', e: '🎉', n: 'Felicitación' },
    aviso:        { c: 'aviso',        e: '',             n: 'Aviso importante' },
    recordatorio: { c: 'recordatorio', e: '',             n: 'Recordatorio' },
    novedad:      { c: 'novedad',      e: '',             n: 'Novedad' }
  };

  /* Orden de aparición: el momento de celebrar abre el show. */
  var ORDEN = { felicitacion: 0, aviso: 1, novedad: 2, recordatorio: 3 };

  /* Palabras que delatan un botón de "terminar el trabajo". */
  var RX_BOTON_GUARDAR = /(guardar|enviar|registrar|crear|generar|actualizar)/i;
  /* Campos que NO cuentan como trabajo a medias (buscadores y filtros). */
  var RX_CAMPO_BUSQUEDA = /(buscar|search|filtro|filter)/i;
  /* Contenedores de login conocidos del ecosistema (ovBlock es el más común). */
  var RX_CONTENEDOR_LOGIN = /(login|ovblock|ovlogin|acceso|autenticacion)/i;
  /* IDs de inputs de login que ya conocemos página por página. */
  var IDS_LOGIN = ['email', 'pass', 'qqEmail', 'qqPass', 'emailInput', 'passInput',
                   'loginEmail', 'loginPass', 'lp'];

  /* --------------------------------------------------------------------- */
  /* Estado del módulo                                                     */
  /* --------------------------------------------------------------------- */

  var cliente        = null;   // cliente de supabase-js que nos pasó la página
  var areaActual     = null;   // 'general', 'kam', 'fam'... o null = "mis áreas"
  var areasCache     = null;   // resultado de novedades_mis_areas()
  var correoCache    = null;   // correo de la sesión (para las reacciones)
  var tPrimeraLlamada= 0;      // marca de tiempo de la primera llamada
  var estadoOv       = null;   // { quitar:fn, cerrar:fn, ids:fn } mientras el overlay está abierto
  var timerRespaldo  = null;
  var timerDebounce  = null;
  var timerBanner    = null;
  var detectorPuesto = false;
  var respaldoPuesto = false;
  var resuscribiendo = false;

  /* Configuración de presentación (§3.1-B). Estos son los defaults que se
     usan si portal.novedades_config no responde o no tiene las columnas. */
  var CFG = {
    tema: 'claro',              // 'claro' (nuevo, default) | 'oscuro' (el v3)
    modo: 'persona',            // 'persona' (default) | 'mosaico'
    segPorPersona: null,        // null = repartir el total entre las pantallas
    reacciones: true
  };
  var cfgEstado = 0;            // 0 = sin pedir · 1 = pidiendo · 2 = resuelta
  var cfgEnEspera = [];         // callbacks esperando la configuración

  /* --------------------------------------------------------------------- */
  /* 1. Estilos: se inyectan en el primer uso, nunca al definir el archivo  */
  /* --------------------------------------------------------------------- */

  /* Fuentes del estándar. Las 13 páginas ya cargan Montserrat + Inter, pero
     NINGUNA trae JetBrains Mono (la fuente de los números del estándar): solo
     esa se pide, y solo si no está ya. Best-effort: si no hay red, los stacks
     de respaldo del CSS mantienen todo legible y nada se bloquea. */
  function asegurarFuentes() {
    if (!document.head || document.getElementById('pgnovFuentes')) { return; }
    try {
      var hojas = document.querySelectorAll('link[rel="stylesheet"]'), i;
      for (i = 0; i < hojas.length; i++) {
        if ((hojas[i].href || '').indexOf('JetBrains') >= 0) { return; }   // ya la trae la página
      }
      var l = document.createElement('link');
      l.id = 'pgnovFuentes';
      l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600;700&display=swap';
      document.head.appendChild(l);
    } catch (e) { /* sin fuentes web: los fallbacks del CSS mandan */ }
  }

  function asegurarEstilos() {
    if (document.getElementById('pgnovStyleV4')) { return; }
    if (!document.head) {
      /* Todavía no hay <head> utilizable: esperamos al DOM. */
      document.addEventListener('DOMContentLoaded', asegurarEstilos);
      return;
    }
    asegurarFuentes();
    var st = document.createElement('style');
    st.id = 'pgnovStyleV4';
    st.textContent =
      /* ---------- Tokens del estándar, ACOTADOS al overlay ----------
         Se declaran sobre .pgnov-ov / .pgnov-banner (nunca en :root) para no
         pisar los tokens de la página que nos hospeda. */
        '.pgnov-ov,.pgnov-banner{'
      + '--ink:#1B2D3A;--ink2:#152430;--mint:#2DBFA3;--mint-deep:#229A82;--mint-soft:#C4E8DF;'
      + '--bg:#F4F7FA;--card:#FFFFFF;--line:#E7EDF2;--txt:#28323B;--muted:#6B7D89;'
      + '--falta:#5B6BD6;--ambar:#D9A520;--rojo:#D5594F;'
      + "--f-tit:'Montserrat',system-ui,-apple-system,Segoe UI,sans-serif;"
      + "--f-body:'Inter',system-ui,-apple-system,Segoe UI,sans-serif;"
      + "--f-num:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;"
      + "--f-gabi:'Fraunces',Georgia,serif;"
      /* Escala de espaciado (v4.1): TODO ritmo vertical sale de aquí.
         8 · 12 · 20 · 32 · 48 — nada de márgenes sueltos. */
      + '--s1:8px;--s2:12px;--s3:20px;--s4:32px;--s5:48px;'
      /* Medida de lectura: ~62 caracteres para el cuerpo normal; el cuerpo
         gigante de la felicitación usa una medida más corta (--medida-hero),
         porque a 27px una línea de 62 caracteres se vuelve un renglón largo. */
      /* OJO: 1ch = ancho del "0", más ancho que la letra minúscula promedio.
         Medido en pantalla, 54ch de Inter ≈ 62 caracteres por renglón, que es
         la medida cómoda que se buscaba; 40ch ≈ 48 caracteres para el cuerpo
         gigante de la felicitación (a 27px, 62 sería un renglón larguísimo). */
      + '--medida:54ch;--medida-hero:40ch;}'

      /* ---------- Lienzo: pantalla completa, sin tarjeta (tema OSCURO) ----------
         v4.1: fuera el verde petróleo #06202A que Andrés rechazó. El oscuro
         ahora es la TINTA del estándar (--ink #1B2D3A) con el mismo degradado
         de la franja `.strip` (#233A4A → #1B2D3A → #152430). */
      + '.pgnov-ov{position:fixed;inset:0;z-index:2147483000;'
      + 'background-color:var(--ink);'
      + 'background-image:linear-gradient(168deg,#233A4A 0%,#1B2D3A 52%,#152430 100%);'
      + 'font-family:var(--f-body);color:#E8F1F3;overflow:hidden;'
      + 'display:flex;flex-direction:column;'
      + '-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;'
      + 'font-variant-ligatures:none;text-shadow:none;}'
      + '.pgnov-ov *{text-shadow:none;}'
      /* overflow-y:auto + safe center: si el contenido no cabe, se puede bajar
         y NO se corta el titulo por arriba (que es lo que pasaba con margin:auto
         dentro de un contenedor con overflow:hidden). */
      + '.pgnov-slide{position:relative;flex:1;min-height:0;width:100%;max-width:1180px;'
      + 'margin:0 auto;display:flex;flex-direction:column;overflow-y:auto;overflow-x:hidden;'
      + 'justify-content:flex-start;justify-content:safe center;'
      + 'padding:clamp(var(--s3),3vh,var(--s4)) clamp(var(--s3),4vw,var(--s5));'
      + 'box-sizing:border-box;opacity:1;transform:translateY(0);'
      + 'transition:opacity .26s ease,transform .26s ease;}'
      + '.pgnov-slide.entrando{opacity:0;transform:translateY(14px);}'
      + '.pgnov-slide.saliendo{opacity:0;transform:translateY(-10px);}'
      + '.pgnov-ov [hidden]{display:none!important;}'

      /* ---------- Barra superior: kicker + progreso ---------- */
      + '.pgnov-top{display:flex;align-items:center;justify-content:space-between;gap:var(--s3);'
      + 'flex:0 0 auto;padding-bottom:clamp(var(--s2),2vh,var(--s3));}'
      + '.pgnov-kicker{font-family:var(--f-tit);font-size:11px;font-weight:700;letter-spacing:.16em;'
      + 'text-transform:uppercase;color:rgba(255,255,255,.72);white-space:nowrap;}'
      + '.pgnov-prog{display:flex;align-items:center;gap:var(--s2);}'
      + '.pgnov-dots{display:inline-flex;align-items:center;gap:6px;}'
      + '.pgnov-dots i{display:block;width:10px;height:10px;border-radius:99px;'
      + 'background:rgba(255,255,255,.22);transition:width .26s ease,background .26s ease;}'
      + '.pgnov-dots i.done{background:rgba(255,255,255,.5);}'
      + '.pgnov-dots i.on{width:26px;background:var(--mint);}'
      /* "1 de 5" del tema oscuro: números en mono con cifras tabulares (no
         bailan al pasar de pantalla) y el "de" en Montserrat. */
      + '.pgnov-count{font-family:var(--f-tit);font-size:11px;font-weight:700;letter-spacing:.14em;'
      + 'color:rgba(255,255,255,.7);text-transform:uppercase;white-space:nowrap;}'
      + '.pgnov-count .num{font-family:var(--f-num);font-size:11.5px;letter-spacing:.04em;'
      + 'color:rgba(255,255,255,.86);'
      + 'font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1,"lnum" 1;}'

      /* ---------- Cuerpo centrado ---------- */
      + '.pgnov-body{flex:1;min-height:0;overflow-y:auto;display:flex;align-items:center;'
      + 'justify-content:center;text-align:center;padding:6px 0;}'
      + '.pgnov-body::-webkit-scrollbar{width:8px;}'
      + '.pgnov-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:99px;}'
      + '.pgnov-in{width:100%;max-width:980px;margin:0 auto;flex:0 0 auto;'
      + 'display:flex;flex-direction:column;'
      + 'align-items:center;gap:clamp(var(--s2),2.2vh,var(--s3));}'
      /* --- NIVEL 3 de la jerarquía: chrome (badge, sub, pie, meta) --- */
      + '.pgnov-badge{display:inline-flex;align-items:center;gap:var(--s1);font-family:var(--f-tit);'
      + 'font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;'
      + 'padding:var(--s1) 18px;border-radius:99px;border:1px solid rgba(255,255,255,.18);'
      + 'background:rgba(255,255,255,.06);color:#fff;line-height:1;}'
      + '.pgnov-badge .em{font-size:15px;line-height:1;letter-spacing:0;}'
      + '.pgnov-sub{font-family:var(--f-body);font-size:12.5px;font-weight:500;letter-spacing:.02em;'
      + 'color:rgba(255,255,255,.6);margin-top:calc(var(--s1) * -.75);'
      + 'font-variant-numeric:tabular-nums;}'
      /* --- NIVEL 1: el título/nombre manda. Montserrat 800, medida fluida,
             letter-spacing negativo (en em, así que se afloja solo en los
             tamaños chicos) y text-wrap:balance para que no queden viudas. --- */
      + '.pgnov-tit{margin:0;font-family:var(--f-tit);font-weight:800;'
      + 'line-height:1.05;letter-spacing:-.022em;color:#fff;'
      + 'text-wrap:balance;text-shadow:none;}'
      /* --- NIVEL 3 (cuerpo): Inter 400, interlínea abierta, medida ~62
             caracteres y text-wrap:pretty para que no cuelgue una palabra. --- */
      + '.pgnov-cue{margin:0;font-weight:400;line-height:1.6;color:rgba(255,255,255,.82);'
      + 'white-space:pre-wrap;max-width:var(--medida);text-wrap:pretty;}'
      /* Cifras de dinero / porcentaje dentro del cuerpo: mono, algo más de
         peso, tamaño relativo para que no rompan el renglón. */
      + '.pgnov-num{font-family:var(--f-num);font-weight:600;font-size:.94em;'
      + 'letter-spacing:-.01em;font-variant-numeric:tabular-nums;'
      + 'font-feature-settings:"tnum" 1,"lnum" 1;white-space:nowrap;}'
      + '.pgnov-pie{font-size:13px;font-weight:500;color:rgba(255,255,255,.6);letter-spacing:.01em;'
      + 'line-height:1.5;max-width:var(--medida);}'
      + '.pgnov-meta{font-family:var(--f-num);font-size:11px;color:rgba(255,255,255,.55);'
      + 'letter-spacing:.06em;text-transform:uppercase;font-variant-numeric:tabular-nums;}'
      /* La foto respeta su proporcion: nunca se estira al ancho del marco.
         Antes era width:100% + object-fit:cover, y una foto cuadrada de persona
         quedaba recortada en un primer plano de la cara (caso Karen, 4-sep). */
      /* El contenedor conserva ancho definido (100%) y la imagen se centra dentro
         SIN estirarse. Ojo: si el contenedor va con width:auto y la imagen con
         max-width:100%, se referencian en circulo y ambos colapsan a 0. */
      + '.pgnov-foto{border-radius:14px;background:transparent;border:0;'
      + 'width:100%;max-width:100%;text-align:center;line-height:0;}'
      + '.pgnov-foto img{display:inline-block;width:auto;height:auto;max-width:100%;'
      + 'max-height:min(380px,30vh);object-fit:contain;border-radius:14px;'
      + 'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);}'

      /* ---------- Enseñanza del mes — bloque opcional, cualquier tipo ---------- */
      + '.pgnov-ens{width:100%;max-width:640px;box-sizing:border-box;text-align:left;'
      + 'border-radius:14px;border:1px solid rgba(217,165,32,.35);border-left:4px solid var(--ambar);'
      + 'background:rgba(217,165,32,.09);padding:var(--s2) 18px var(--s2) 18px;'
      + 'display:flex;flex-direction:column;gap:var(--s1);margin-top:var(--s1);}'
      + '.pgnov-ens-badge{align-self:flex-start;display:inline-flex;align-items:center;gap:6px;'
      + 'font-family:var(--f-tit);font-size:10px;font-weight:700;letter-spacing:.16em;'
      + 'text-transform:uppercase;padding:4px 10px;border-radius:99px;line-height:1;'
      + 'background:rgba(217,165,32,.2);color:#F7DFA2;}'
      + '.pgnov-ens-badge::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--ambar);}'
      + '.pgnov-ens-texto{margin:0;font-weight:400;line-height:1.6;color:rgba(255,255,255,.85);'
      + 'font-size:14.5px;max-width:var(--medida);text-wrap:pretty;}'
      + '.pgnov-ens-acento{color:#F7DFA2;font-weight:700;}'

      /* ---------- FELICITACIÓN — la estrella del formato (oscuro) ---------- */
      /* Andrés no quiere verde en el fondo: en el tema oscuro el halo de la
         felicitación es LUZ BLANCA (sin tinte), no menta. La celebración la
         ponen el confeti, la insignia, el anillo de la foto y el logro —
         todos en menta, que es acento sobre la tinta, no fondo. */
      + '.pgnov-ov.t-felicitacion{background-color:var(--ink);'
      + 'background-image:radial-gradient(76% 50% at 50% 0%,'
      + 'rgba(255,255,255,.055) 0%,rgba(255,255,255,0) 72%),'
      + 'linear-gradient(168deg,#233A4A 0%,#1B2D3A 52%,#152430 100%);}'
      + '.t-felicitacion .pgnov-badge{color:var(--mint);border-color:rgba(45,191,163,.45);'
      + 'background:rgba(45,191,163,.10);}'
      + '.t-felicitacion .pgnov-tit{font-size:clamp(34px,5.6vw,74px);letter-spacing:-.03em;}'
      + '.t-felicitacion .pgnov-in.sin-foto .pgnov-tit{font-size:clamp(42px,7.5vw,96px);'
      + 'letter-spacing:-.035em;}'
      /* Cuerpo grande: medida corta (46ch) e interlínea 1.5 — a 27px, 62
         caracteres serían un renglón larguísimo. */
      + '.t-felicitacion .pgnov-cue{font-size:clamp(17px,2.1vw,27px);line-height:1.5;'
      + 'max-width:var(--medida-hero);}'
      + '.t-felicitacion .pgnov-fel-foto{border-radius:22px;overflow:hidden;'
      + 'border:2px solid rgba(45,191,163,.55);box-shadow:0 24px 70px rgba(0,0,0,.5),'
      + '0 0 0 10px rgba(45,191,163,.08);background:rgba(45,191,163,.08);max-width:min(660px,92%);}'
      + '.t-felicitacion .pgnov-fel-foto img{display:block;width:100%;height:min(46vh,430px);object-fit:cover;}'
      + '.t-felicitacion .pgnov-pie{color:var(--mint);}'
      /* Confeti sutil, sin librerías y sin tapar el contenido. */
      + '.pgnov-confeti{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0;}'
      + '.pgnov-confeti i{position:absolute;top:-14px;width:8px;height:12px;border-radius:2px;'
      + 'opacity:.5;animation:pgnovCae linear infinite;}'
      + '@keyframes pgnovCae{0%{transform:translateY(-10vh) rotate(0deg);opacity:0;}'
      + '10%{opacity:.55;}100%{transform:translateY(112vh) rotate(420deg);opacity:0;}}'
      + '@media(prefers-reduced-motion:reduce){.pgnov-confeti{display:none;}'
      + '.pgnov-slide{transition:none;}}'
      + '.pgnov-slide>.pgnov-top,.pgnov-slide>.pgnov-body,.pgnov-slide>.pgnov-bot{position:relative;z-index:1;}'

      /* ---------- Mosaico de la ronda (modo_ronda = mosaico) ---------- */
      + '.pgnov-mos{display:flex;flex-wrap:wrap;justify-content:center;gap:16px;width:100%;max-width:900px;}'
      + '.pgnov-mos-card{width:270px;box-sizing:border-box;background:rgba(255,255,255,.055);'
      + 'border:1px solid rgba(45,191,163,.22);border-radius:18px;padding:22px 18px 20px;'
      + 'display:flex;flex-direction:column;align-items:center;gap:9px;box-shadow:0 18px 50px rgba(0,0,0,.35);}'
      + '.pgnov-mos-foto,.pgnov-mos-ini{width:160px;height:160px;border-radius:16px;overflow:hidden;'
      + 'border:2px solid rgba(45,191,163,.75);box-shadow:0 0 0 8px rgba(45,191,163,.08),'
      + '0 16px 40px rgba(0,0,0,.45);background:rgba(45,191,163,.08);flex-shrink:0;}'
      + '.pgnov-mos-foto img{display:block;width:100%;height:100%;object-fit:cover;}'
      + '.pgnov-mos-ini{background:linear-gradient(150deg,var(--mint-deep),#1B7A67);color:#fff;'
      + 'font-family:var(--f-tit);font-weight:800;font-size:58px;letter-spacing:-.02em;'
      + 'display:flex;align-items:center;justify-content:center;}'
      /* Mismos tres niveles que la pantalla grande, en miniatura. */
      + '.pgnov-mos-nom{font-family:var(--f-tit);font-weight:800;font-size:20px;line-height:1.08;'
      + 'color:#fff;margin-top:var(--s1);letter-spacing:-.018em;text-wrap:balance;}'
      + '.pgnov-mos-logro{font-family:var(--f-tit);font-size:10px;font-weight:700;letter-spacing:.16em;'
      + 'text-transform:uppercase;color:var(--mint);line-height:1.4;}'
      + '.pgnov-mos-cue{font-size:13.5px;font-weight:400;line-height:1.55;'
      + 'color:rgba(255,255,255,.78);margin:0;text-wrap:pretty;}'
      /* Mosaico DENSO: 4 o más personas en una sola pantalla, para que la
         ronda completa quepa sin scroll en una pantalla de portátil. */
      + '.pgnov-mos.denso .pgnov-mos-card{width:212px;padding:16px 14px 15px;gap:7px;}'
      + '.pgnov-mos.denso .pgnov-mos-foto,.pgnov-mos.denso .pgnov-mos-ini{width:118px;height:118px;font-size:42px;}'
      + '.pgnov-mos.denso .pgnov-mos-nom{font-size:17px;margin-top:4px;}'
      + '.pgnov-mos.denso .pgnov-mos-logro{font-size:9.5px;}'
      + '.pgnov-mos.denso .pgnov-mos-cue{font-size:12.5px;}'

      /* ---------- Pantalla POR PERSONA (modo_ronda = persona) ---------- */
      /* Ritmo vertical de la pantalla por persona, con la escala:
         badge —(s3)— retrato —(s3)— NOMBRE —(s1)— logro —(s3)— cuerpo. */
      + '.pgnov-per{display:flex;flex-direction:column;align-items:center;gap:var(--s3);'
      + 'text-align:center;width:100%;}'
      /* El logro se pega al nombre (s1 = 8px) en vez de flotar a s3. */
      + '.pgnov-per>.pgnov-per-nom+.pgnov-per-logro{margin-top:calc(var(--s1) - var(--s3));}'
      + '.pgnov-per-foto,.pgnov-per-ini{width:min(252px,24vh);height:min(252px,24vh);'
      + 'border-radius:22px;overflow:hidden;'
      + 'border:3px solid var(--mint);box-shadow:0 0 0 10px rgba(45,191,163,.12),'
      + '0 24px 60px rgba(0,0,0,.4);background:rgba(45,191,163,.08);flex-shrink:0;}'
      + '.pgnov-per-foto img{display:block;width:100%;height:100%;object-fit:cover;}'
      + '.pgnov-per-ini{background:linear-gradient(150deg,var(--mint-deep),#1B7A67);color:#fff;'
      + 'font-family:var(--f-tit);font-weight:800;font-size:96px;letter-spacing:-.03em;'
      + 'display:flex;align-items:center;justify-content:center;}'
      /* NIVEL 1 — el nombre manda. */
      + '.pgnov-per-nom{font-family:var(--f-tit);font-weight:800;font-size:clamp(32px,5vw,54px);'
      + 'line-height:1.02;letter-spacing:-.028em;color:#fff;margin:0;'
      + 'text-wrap:balance;text-shadow:none;max-width:20ch;}'
      /* NIVEL 2 — el logro: mayúscula espaciada, menta, peso 700, pequeño. */
      + '.pgnov-per-logro{display:inline-block;font-family:var(--f-tit);font-size:11px;font-weight:700;'
      + 'letter-spacing:.18em;text-transform:uppercase;padding:7px 15px;border-radius:999px;'
      + 'line-height:1;background:rgba(45,191,163,.16);color:var(--mint);}'
      /* NIVEL 3 — el cuerpo. */
      + '.pgnov-per-cue{font-size:clamp(16px,1.6vw,19px);font-weight:400;line-height:1.62;'
      + 'color:rgba(255,255,255,.82);max-width:var(--medida);margin:0;'
      + 'white-space:pre-wrap;text-wrap:pretty;}'

      /* ---------- AVISO — serio y que pese ---------- */
      + '.pgnov-ov.t-aviso{background-color:var(--ink);'
      + 'background-image:linear-gradient(180deg,#26404F 0%,#1B2D3A 58%,#152430 100%);}'
      + '.pgnov-ov.t-aviso::before{content:"";position:absolute;top:0;left:0;right:0;'
      + 'height:10px;background:var(--ambar);z-index:2;}'
      + '.t-aviso .pgnov-dots i.on{background:var(--ambar);}'
      + '.pgnov-marco{width:100%;max-width:820px;box-sizing:border-box;background:var(--card);'
      + 'color:var(--txt);border:2px solid var(--ambar);border-radius:20px;'
      + 'padding:clamp(var(--s3),3.2vh,var(--s4)) clamp(var(--s3),3.6vw,var(--s5));'
      + 'display:flex;flex-direction:column;'
      + 'align-items:center;gap:clamp(var(--s2),2vh,var(--s3));box-shadow:0 30px 80px rgba(0,0,0,.45);}'
      /* La etiqueta ámbar es TEXTO, no número: va en Montserrat como los demás
         eyebrows del estándar (antes estaba en JetBrains Mono). */
      + '.pgnov-enc{display:inline-flex;align-items:center;gap:var(--s1);font-family:var(--f-tit);'
      + 'font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;line-height:1;'
      + 'color:#8A6A14;background:#FBF1D8;border-radius:999px;padding:7px 15px;}'
      + '.pgnov-enc::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--ambar);}'
      + '.pgnov-marco .pgnov-tit{color:var(--ink);font-size:clamp(26px,3.4vw,42px);'
      + 'letter-spacing:-.024em;max-width:24ch;}'
      + '.pgnov-marco .pgnov-cue{color:var(--txt);font-size:clamp(15px,1.5vw,17.5px);'
      + 'max-width:var(--medida);}'
      + '.pgnov-marco .pgnov-meta{color:var(--muted);}'
      + '.pgnov-marco .pgnov-pie{color:var(--muted);}'
      + '.pgnov-marco .pgnov-foto img{background:var(--bg);border:1px solid var(--line);}'
      + '.pgnov-marco .pgnov-ens{background:#FFFBF0;border-color:#ECD08C;border-left-color:var(--ambar);}'
      + '.pgnov-marco .pgnov-ens-badge{background:#FBF1D8;color:#8A6A14;}'
      + '.pgnov-marco .pgnov-ens-texto{color:var(--txt);}'
      + '.pgnov-marco .pgnov-ens-acento{color:#8A6A14;}'

      /* ---------- NOVEDAD de herramienta — tarjeta compacta ---------- */
      + '.pgnov-ov.t-novedad{background-color:var(--ink);'
      + 'background-image:linear-gradient(180deg,#26404F 0%,#1B2D3A 58%,#152430 100%);}'
      + '.t-novedad .pgnov-dots i.on{background:var(--mint-deep);}'
      + '.t-novedad .pgnov-badge{color:#9FE3D3;border-color:rgba(34,154,130,.55);'
      + 'background:rgba(34,154,130,.16);}'
      + '.pgnov-nov{width:100%;max-width:720px;box-sizing:border-box;background:rgba(255,255,255,.05);'
      + 'border:1px solid rgba(34,154,130,.4);border-left:4px solid var(--mint-deep);border-radius:16px;'
      + 'padding:clamp(var(--s3),3vh,var(--s4)) var(--s4);text-align:left;'
      + 'display:flex;flex-direction:column;gap:var(--s2);align-items:flex-start;}'
      + '.pgnov-nov .pgnov-tit{font-size:clamp(22px,2.6vw,30px);letter-spacing:-.022em;'
      + 'max-width:26ch;}'
      + '.pgnov-nov .pgnov-cue{font-size:15.5px;line-height:1.6;max-width:var(--medida);}'
      + '.pgnov-nov .pgnov-pie{text-align:left;}'

      /* ---------- RECORDATORIO — el más sobrio ---------- */
      + '.pgnov-ov.t-recordatorio{background-color:var(--ink);'
      + 'background-image:linear-gradient(180deg,#213544 0%,#1B2D3A 55%,#152430 100%);}'
      + '.t-recordatorio .pgnov-dots i.on{background:#8DA0AD;}'
      + '.t-recordatorio .pgnov-badge{color:#B7C7D0;border-color:rgba(141,160,173,.4);'
      + 'background:rgba(141,160,173,.10);}'
      + '.t-recordatorio .pgnov-tit{font-size:clamp(26px,3.4vw,44px);letter-spacing:-.024em;'
      + 'max-width:24ch;}'
      + '.t-recordatorio .pgnov-cue{font-size:clamp(16px,1.8vw,22px);line-height:1.55;}'

      /* ---------- Pie: pausa + barra + botón + reacciones + enlace ---------- */
      + '.pgnov-bot{flex:0 0 auto;padding-top:clamp(12px,2.2vh,22px);display:flex;'
      + 'flex-direction:column;align-items:center;gap:10px;}'
      + '.pgnov-pausa{display:none;background:rgba(217,165,32,.14);border:1px solid rgba(217,165,32,.45);'
      + 'color:#F7DFA2;border-radius:9px;padding:8px 14px;font-size:12.5px;font-weight:600;text-align:center;}'
      + '.pgnov-bar{width:min(420px,100%);height:6px;border-radius:99px;'
      + 'background:rgba(255,255,255,.14);overflow:hidden;}'
      + '.pgnov-bar i{display:block;height:100%;width:0;background:var(--mint);transition:width .95s linear;}'
      + '.t-aviso .pgnov-bar i{background:var(--ambar);}'
      + '.t-novedad .pgnov-bar i{background:var(--mint-deep);}'
      + '.t-recordatorio .pgnov-bar i{background:#8DA0AD;}'
      + '.pgnov-btn{width:min(420px,100%);padding:16px;border:none;border-radius:12px;'
      + 'font-family:var(--f-body);font-weight:800;font-size:15px;cursor:pointer;letter-spacing:.01em;'
      + 'background:var(--mint);color:var(--ink);transition:filter .2s,background .2s;}'
      + '.t-aviso .pgnov-btn{background:var(--ambar);color:var(--ink);}'
      + '.t-novedad .pgnov-btn{background:var(--mint-deep);color:#fff;}'
      + '.t-recordatorio .pgnov-btn{background:#8DA0AD;color:var(--ink);}'
      + '.pgnov-btn:hover:not(:disabled){filter:brightness(1.08);}'
      /* Deshabilitado: tiene que leerse INERTE sobre cualquiera de los fondos. */
      + '.pgnov-ov .pgnov-btn:disabled{background:rgba(255,255,255,.05);color:rgba(255,255,255,.62);'
      + 'box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);cursor:not-allowed;filter:none;'
      + 'font-weight:600;font-size:14px;letter-spacing:.02em;}'
      + '.pgnov-btn .num{font-family:var(--f-num);font-weight:700;font-size:15px;color:#fff;}'
      + '.pgnov-note{font-size:11.5px;color:rgba(255,255,255,.55);text-align:center;'
      + 'line-height:1.5;white-space:pre-line;min-height:16px;}'
      + '.pgnov-reac{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;transition:opacity .2s;}'
      + '.pgnov-reac.off{opacity:.38;pointer-events:none;}'
      + '.pgnov-rx{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;'
      + 'border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;'
      + 'font-size:15px;line-height:1;cursor:pointer;transition:all .15s;font-family:var(--f-body);}'
      + '.pgnov-rx .n{font-family:var(--f-num);font-size:12px;font-weight:700;color:rgba(255,255,255,.75);}'
      + '.pgnov-rx:hover{border-color:var(--mint);background:rgba(45,191,163,.14);}'
      + '.pgnov-rx.mia{border-color:var(--mint);background:rgba(45,191,163,.18);}'
      + '.pgnov-rx.mia .n{color:var(--mint);}'
      + '.pgnov-link{font-size:12.5px;font-weight:600;color:var(--mint);text-decoration:none;}'
      + '.pgnov-link:hover{text-decoration:underline;}'

      /* ===================================================================
         TEMA CLARO (default v4) — temática Renovaciones v27
         =================================================================== */
      /* Fondo del tema claro (v4.1): NO es un gris plano. Sobre --bg #F4F7FA
         van dos lavados muy suaves — blanco radial al centro (donde vive el
         panel, así el panel blanco "flota" en vez de recortarse) y un halo
         menta apenas perceptible arriba. La menta queda muy por debajo del
         tope de 15 % del área: alfa .09–.13 desvaneciendo a 0. */
      + '.pgnov-ov.claro{color:var(--txt);background-color:var(--bg);'
      /* 1) halo menta DETRÁS del panel (el del dashboard de Renovaciones) */
      + 'background-image:radial-gradient(38% 40% at 50% 46%,rgba(45,191,163,.10) 0%,'
      + 'rgba(45,191,163,0) 72%),'
      /* 2) lavado blanco amplio y suave: quita lo plano sin borrar el panel */
      + 'radial-gradient(130% 88% at 50% 8%,rgba(255,255,255,.85) 0%,'
      + 'rgba(255,255,255,.35) 46%,rgba(255,255,255,0) 78%);}'
      + '.pgnov-ov.claro.t-felicitacion{background-color:var(--bg);'
      + 'background-image:radial-gradient(44% 46% at 50% 44%,rgba(45,191,163,.15) 0%,'
      + 'rgba(45,191,163,0) 70%),'
      + 'radial-gradient(130% 88% at 50% 8%,rgba(255,255,255,.80) 0%,'
      + 'rgba(255,255,255,.30) 46%,rgba(255,255,255,0) 78%);}'
      + '.pgnov-ov.claro.t-aviso::before{display:none;}'
      /* barra superior blanca: GABI | NOVEDADES · n de N + píldora del contador */
      + '.pgnov-ovtop{flex:0 0 auto;background:#fff;border-bottom:1px solid var(--line);'
      + 'position:relative;z-index:2;}'
      + '.pgnov-ovtop-in{max-width:1180px;margin:0 auto;display:flex;align-items:center;'
      + 'justify-content:space-between;gap:14px;padding:12px clamp(20px,4vw,56px);}'
      + '.pgnov-brand{display:flex;align-items:baseline;gap:10px;min-width:0;}'
      + '.pgnov-gabi{font-family:var(--f-gabi);font-style:italic;font-weight:800;font-size:27px;'
      + 'color:var(--ink);letter-spacing:-.5px;}'
      + '.pgnov-sep{width:1px;height:20px;background:var(--line);align-self:center;}'
      + '.pgnov-sec{font-family:var(--f-tit);font-weight:700;font-size:12px;letter-spacing:.16em;'
      + 'text-transform:uppercase;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
      /* "1 de 5" en la barra clara: los números en mono, el "de" en Montserrat. */
      + '.pgnov-secn{margin-left:4px;}'
      + '.pgnov-sec .num{font-family:var(--f-num);font-weight:700;letter-spacing:.04em;'
      + 'color:var(--ink);font-variant-numeric:tabular-nums;'
      + 'font-feature-settings:"tnum" 1,"lnum" 1;}'
      /* Píldora del contador: cifras tabulares para que 0:18 → 0:09 no baile. */
      + '.pgnov-cdpill{display:inline-flex;align-items:center;gap:var(--s1);font-family:var(--f-num);'
      + 'font-weight:700;font-size:14px;background:#0D3040;color:#fff;border-radius:999px;'
      + 'padding:7px 15px;letter-spacing:.02em;white-space:nowrap;flex-shrink:0;'
      + 'font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1,"lnum" 1;}'
      + '.pgnov-cdpill small{font-family:var(--f-body);font-weight:500;font-size:11px;opacity:.7;}'
      + '.pgnov-cdpill.ok{background:var(--mint-deep);}'
      + '.claro .pgnov-slide{padding-top:clamp(16px,2.6vh,28px);}'
      + '.claro .pgnov-kicker,.claro .pgnov-count,.claro .pgnov-sub,'
      + '.claro .pgnov-note,.claro .pgnov-meta,.claro .pgnov-pie{color:var(--muted);}'
      + '.claro .pgnov-dots i{background:#D5DEE5;}'
      + '.claro .pgnov-dots i.done{background:#9FB0BC;}'
      + '.claro .pgnov-dots i.on,.claro.t-novedad .pgnov-dots i.on{background:var(--mint-deep);}'
      + '.claro.t-aviso .pgnov-dots i.on{background:var(--ambar);}'
      + '.claro .pgnov-badge,.claro.t-felicitacion .pgnov-badge{color:#186F5D;'
      + 'border-color:var(--mint-soft);background:var(--mint-soft);}'
      + '.claro.t-novedad .pgnov-badge{color:#3E4CB0;border-color:#E6E9FA;background:#E6E9FA;}'
      + '.claro.t-recordatorio .pgnov-badge{color:#5A6B78;border-color:#EEF1F4;background:#EEF1F4;}'
      + '.claro .pgnov-tit{color:var(--ink);}'
      + '.claro .pgnov-cue{color:var(--txt);}'
      /* panel blanco 820 px radio 16 */
      + '.pgnov-panel{width:100%;max-width:820px;box-sizing:border-box;background:var(--card);'
      + 'border:1px solid var(--line);border-radius:16px;'
      + 'padding:clamp(var(--s3),2.8vh,var(--s4)) clamp(var(--s3),4vw,var(--s5));'
      + 'display:flex;flex-direction:column;'
      + 'align-items:center;gap:var(--s3);box-shadow:0 18px 46px rgba(27,45,58,.10),0 2px 6px rgba(27,45,58,.06);}'
      /* En claro el nombre también manda: sube de 34 a 44px de tope. */
      + '.claro .pgnov-per-nom{color:var(--ink);font-size:clamp(30px,4.2vw,44px);}'
      + '.claro .pgnov-per-logro{background:var(--mint-soft);color:#186F5D;letter-spacing:.18em;}'
      + '.claro .pgnov-per-cue{color:var(--txt);font-size:17px;}'
      + '.claro .pgnov-num{color:var(--ink);}'
      + '.pgnov-num{color:#EAF6F3;}'
      + '.claro .pgnov-per-foto{box-shadow:0 0 0 10px rgba(45,191,163,.14),0 14px 34px rgba(27,45,58,.16);}'
      + '.claro .pgnov-per-ini{box-shadow:0 0 0 10px rgba(45,191,163,.14),0 14px 34px rgba(27,45,58,.16);'
      + 'border-color:#fff;}'
      + '.claro .pgnov-ens{background:#FFFBF0;border-color:#ECD08C;border-left-color:var(--ambar);}'
      + '.claro .pgnov-ens-badge{background:#FBF1D8;color:#8A6A14;}'
      + '.claro .pgnov-ens-texto{color:var(--txt);}'
      + '.claro .pgnov-ens-acento{color:#8A6A14;}'
      + '.claro .pgnov-mos-card{background:#fff;border:1px solid var(--line);'
      + 'box-shadow:0 6px 18px rgba(27,45,58,.08);}'
      + '.claro .pgnov-mos-nom{color:var(--ink);}'
      + '.claro .pgnov-mos-logro{color:var(--mint-deep);}'
      + '.claro .pgnov-mos-cue{color:var(--muted);}'
      + '.claro .pgnov-mos-foto{box-shadow:0 0 0 8px rgba(45,191,163,.12);}'
      + '.claro .pgnov-mos-ini{box-shadow:0 0 0 8px rgba(45,191,163,.12);border-color:#fff;}'
      + '.claro .pgnov-foto img{background:var(--bg);border:1px solid var(--line);}'
      + '.claro .pgnov-fel-foto{border-color:rgba(45,191,163,.55);'
      + 'box-shadow:0 0 0 10px rgba(45,191,163,.12),0 14px 34px rgba(27,45,58,.16);}'
      /* el aviso claro: panel blanco con borde superior ámbar de 6 px */
      + '.claro .pgnov-marco{background:var(--card);border:1px solid var(--line);'
      + 'border-top:6px solid var(--ambar);border-radius:16px;'
      + 'box-shadow:0 10px 40px rgba(27,45,58,.10);}'
      /* la novedad de herramienta clara: borde izquierdo azul --falta */
      + '.claro .pgnov-nov{background:#fff;border:1px solid var(--line);'
      + 'border-left:4px solid var(--falta);box-shadow:0 10px 40px rgba(27,45,58,.10);}'
      + '.claro .pgnov-bar{background:#E7EDF2;}'
      + '.claro .pgnov-bar i,.claro.t-novedad .pgnov-bar i,'
      + '.claro.t-recordatorio .pgnov-bar i{background:var(--mint-deep);}'
      + '.claro.t-aviso .pgnov-bar i{background:var(--ambar);}'
      + '.claro .pgnov-btn{background:var(--ink);color:#fff;border-radius:9px;}'
      + '.claro .pgnov-btn:hover:not(:disabled){background:var(--ink2);filter:none;}'
      + '.pgnov-ov.claro .pgnov-btn:disabled{background:#fff;color:var(--muted);'
      + 'box-shadow:inset 0 0 0 1px var(--line);}'
      + '.claro .pgnov-btn .num{color:var(--ink);}'
      + '.claro .pgnov-pausa{background:#FBF1D8;border-color:#ECD08C;color:#8A6A14;}'
      + '.claro .pgnov-rx{border-color:var(--line);background:#fff;color:var(--txt);}'
      + '.claro .pgnov-rx .n{color:var(--muted);}'
      + '.claro .pgnov-rx:hover{background:#F7FCFB;}'
      + '.claro .pgnov-rx.mia{border-color:var(--mint);background:rgba(45,191,163,.12);}'
      + '.claro .pgnov-rx.mia .n{color:var(--mint-deep);}'
      + '.claro .pgnov-link{color:var(--mint-deep);}'
      + '.claro .pgnov-confeti i{opacity:.26;}'
      + '.claro .pgnov-body::-webkit-scrollbar-thumb{background:#C9D4DC;}'

      /* ---------- Celular ---------- */
      + '@media(max-width:640px){'
      /* En celular la escala se comprime un paso: 8/12/16/24/32. */
      + '.pgnov-ov,.pgnov-banner{--s3:16px;--s4:24px;--s5:32px;--medida:44ch;--medida-hero:32ch;}'
      + '.pgnov-slide{padding:var(--s3) var(--s3) 18px;}'
      + '.pgnov-body{align-items:flex-start;}'
      + '.pgnov-in{gap:var(--s3);}'
      + '.pgnov-top{flex-wrap:wrap;gap:var(--s1);}'
      + '.pgnov-kicker{font-size:10px;}'
      + '.pgnov-ovtop-in{padding:10px 14px;}'
      + '.pgnov-gabi{font-size:22px;}'
      + '.pgnov-sec{font-size:10.5px;letter-spacing:.08em;}'
      + '.pgnov-cdpill{font-size:12.5px;padding:6px 11px;}'
      + '.pgnov-cdpill small{display:none;}'
      + '.pgnov-panel{padding:20px 16px;}'
      + '.pgnov-per-foto,.pgnov-per-ini{width:200px;height:200px;font-size:72px;}'
      /* Menos negativo el tracking en tamaño chico: -.028em apretaría. */
      + '.pgnov-per-nom,.claro .pgnov-per-nom{font-size:28px;letter-spacing:-.016em;'
      + 'line-height:1.08;max-width:none;}'
      + '.pgnov-per-cue,.claro .pgnov-per-cue{font-size:15.5px;line-height:1.6;}'
      + '.pgnov-per-logro{letter-spacing:.14em;}'
      + '.pgnov-per{gap:var(--s3);}'
      + '.pgnov-mos-card{width:100%;flex-direction:row;text-align:left;align-items:center;'
      + 'gap:14px;padding:14px;}'
      + '.pgnov-mos-foto,.pgnov-mos-ini{width:96px;height:96px;font-size:36px;border-radius:14px;}'
      + '.pgnov-mos-nom{font-size:17px;margin-top:0;}'
      /* el mosaico denso vuelve a fila completa en celular */
      + '.pgnov-mos.denso .pgnov-mos-card{width:100%;padding:14px;}'
      + '.pgnov-mos.denso .pgnov-mos-foto,.pgnov-mos.denso .pgnov-mos-ini{width:96px;height:96px;font-size:36px;}'
      + '.pgnov-mos.denso .pgnov-mos-nom{font-size:17px;}'
      + '.pgnov-mos.denso .pgnov-mos-logro{font-size:10.5px;}'
      + '.pgnov-mos.denso .pgnov-mos-cue{font-size:13px;}'
      + '.pgnov-mos-txt{display:flex;flex-direction:column;gap:6px;min-width:0;}'
      + '.t-felicitacion .pgnov-tit{font-size:clamp(28px,8vw,44px);letter-spacing:-.02em;}'
      + '.t-felicitacion .pgnov-in.sin-foto .pgnov-tit{font-size:clamp(32px,10vw,52px);'
      + 'letter-spacing:-.024em;}'
      + '.pgnov-tit,.pgnov-marco .pgnov-tit,.pgnov-nov .pgnov-tit{max-width:none;}'
      + '.t-felicitacion .pgnov-fel-foto{max-width:100%;}'
      + '.t-felicitacion .pgnov-fel-foto img{height:34vh;}'
      + '.t-felicitacion .pgnov-cue{font-size:16.5px;}'
      + '.pgnov-marco .pgnov-tit,.t-novedad .pgnov-tit{font-size:clamp(24px,7vw,34px);}'
      + '.t-recordatorio .pgnov-tit{font-size:clamp(22px,6.4vw,32px);}'
      + '.pgnov-marco .pgnov-cue,.t-novedad .pgnov-cue,'
      + '.t-recordatorio .pgnov-cue{font-size:16px;}'
      + '.pgnov-marco{padding:18px 16px;}'
      + '.pgnov-nov{padding:20px 18px;}'
      + '.pgnov-ens{padding:14px 16px;}'
      + '.pgnov-ens-texto{font-size:14.5px;}'
      + '.pgnov-btn,.pgnov-bar{width:100%;}'
      + '}'
      + '@media(min-width:641px){.pgnov-mos-txt{display:contents;}}'

      /* ---------- Banner rojo del bloqueo protegido (igual que el v3) ---------- */
      + '.pgnov-banner{position:fixed;top:0;left:0;right:0;z-index:2147482000;background:#C0392B;'
      + 'color:#fff;font-family:var(--f-body);font-size:13.5px;font-weight:600;'
      + 'line-height:1.4;padding:11px 16px;display:flex;align-items:center;justify-content:center;'
      + 'gap:14px;box-shadow:0 4px 14px rgba(0,0,0,.28);}'
      + '.pgnov-banner .msg{max-width:760px;}'
      + '.pgnov-banner button{background:#fff;color:#C0392B;border:none;border-radius:8px;'
      + 'padding:7px 14px;font-weight:800;font-size:12.5px;cursor:pointer;font-family:inherit;'
      + 'white-space:nowrap;}'
      + '.pgnov-banner button:hover{background:#f6e2df;}'
      + '@media(max-width:560px){.pgnov-banner{flex-direction:column;gap:8px;font-size:12.5px;padding:10px 12px;}}';
    document.head.appendChild(st);
  }

  /* --------------------------------------------------------------------- */
  /* 2. Utilidades                                                         */
  /* --------------------------------------------------------------------- */

  function hayOverlay() {
    return !!document.getElementById('pgnovOv');
  }

  function hayBanner() {
    return !!document.getElementById('pgnovBanner');
  }

  function tipoDe(n) {
    var t = (n && n.tipo) || 'novedad';
    return TIPOS[t] ? t : 'novedad';
  }

  /* Crea un nodo con texto seguro (nunca innerHTML con datos de la base). */
  function nodo(tag, clase, texto) {
    var e = document.createElement(tag);
    if (clase) { e.className = clase; }
    if (texto !== undefined && texto !== null) { e.textContent = texto; }
    return e;
  }

  function vaciar(el) {
    while (el && el.firstChild) { el.removeChild(el.firstChild); }
  }

  /* --------------------------------------------------------------------- */
  /* Cifras del cuerpo en JetBrains Mono (v4.1)                            */
  /* --------------------------------------------------------------------- */
  /* Regla del estándar: TODOS los números en mono. En el cuerpo de una
     novedad las cifras llegan dentro de un párrafo escrito a mano, así que
     se detectan y se envuelven al pintar. Reconoce:
        $56,832.73 · $ 5,208 · 15% · 15,5 % · 1,250,000 · 3.500
     y NO toca "lunes 6 de octubre", "2026-W36" ni el punto final de la frase
     (el patrón siempre cierra en dígito).
     Se arma SOLO con nodos de texto y createElement: jamás innerHTML. */
  var RE_CIFRA = /\$\s?\d(?:[\d.,]*\d)?(?:\s?(?:MM|mm|[KkMm])\b)?|\d(?:[\d.,]*\d)?\s?%|\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?/g;

  function pintarCifras(elemento, texto) {
    var s = String(texto === undefined || texto === null ? '' : texto);
    var m, ultimo = 0, span;
    RE_CIFRA.lastIndex = 0;
    while ((m = RE_CIFRA.exec(s)) !== null) {
      if (!m[0]) { RE_CIFRA.lastIndex++; continue; }          /* nunca ciclo infinito */
      if (m.index > ultimo) {
        elemento.appendChild(document.createTextNode(s.slice(ultimo, m.index)));
      }
      span = document.createElement('span');
      span.className = 'pgnov-num';
      span.textContent = m[0];
      elemento.appendChild(span);
      ultimo = m.index + m[0].length;
    }
    if (ultimo < s.length) { elemento.appendChild(document.createTextNode(s.slice(ultimo))); }
    return elemento;
  }

  /* Párrafo/línea de cuerpo con las cifras ya en mono. */
  function parrafo(tag, clase, texto) {
    var e = document.createElement(tag);
    if (clase) { e.className = clase; }
    return pintarCifras(e, texto);
  }

  function iniciales(nombre) {
    var p = String(nombre || '').trim().split(/\s+/), r = '';
    if (p[0]) { r += p[0].charAt(0); }
    if (p[1]) { r += p[1].charAt(0); }
    return r.toUpperCase() || '?';
  }

  function mmss(seg) {
    var m = Math.floor(seg / 60), s = seg % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* Orden de aparición: felicitaciones → avisos → novedades → recordatorios.
     Dentro de cada grupo se respeta el orden en que vino la RPC (sort estable
     emulado con el índice original). */
  function ordenar(items) {
    return items
      .map(function (n, i) { return { n: n, i: i }; })
      .sort(function (a, b) {
        var da = ORDEN[tipoDe(a.n)], db = ORDEN[tipoDe(b.n)];
        if (da !== db) { return da - db; }
        return a.i - b.i;
      })
      .map(function (x) { return x.n; });
  }

  /* --------------------------------------------------------------------- */
  /* 3. Detección de "formulario sucio" (window.pgFormSucio)               */
  /* --------------------------------------------------------------------- */

  /* ¿Este campo está dentro de un login? (no cuenta como trabajo a medias) */
  function dentroDeLogin(el) {
    var n = el, pasos = 0;
    while (n && n.nodeType === 1 && pasos < 12) {
      var marca = (n.id || '') + ' ' + (typeof n.className === 'string' ? n.className : '');
      if (RX_CONTENEDOR_LOGIN.test(marca)) { return true; }
      n = n.parentNode; pasos++;
    }
    return false;
  }

  /* Campos que NO deben marcar el formulario como sucio. */
  function campoExcluido(el) {
    if (!el || !el.tagName) { return true; }
    var tag = el.tagName.toUpperCase();
    /* Los editores de texto enriquecido (actas, notas) son un <div> con
       contenteditable, no INPUT/SELECT/TEXTAREA. */
    if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA' && el.isContentEditable !== true) { return true; }

    var tipo = (el.type || '').toLowerCase();
    if (tipo === 'password' || tipo === 'search' || tipo === 'hidden' || tipo === 'submit' || tipo === 'button') { return true; }

    /* IDs de login conocidos de las páginas del ecosistema. */
    var i;
    for (i = 0; i < IDS_LOGIN.length; i++) {
      if (el.id === IDS_LOGIN[i]) { return true; }
    }

    /* Buscadores y filtros: por id, name, clase, placeholder o aria-label. */
    var firma = (el.id || '') + ' ' + (el.name || '') + ' '
              + (typeof el.className === 'string' ? el.className : '') + ' '
              + (el.getAttribute ? (el.getAttribute('placeholder') || '') + ' '
                                 + (el.getAttribute('aria-label') || '') : '');
    if (RX_CAMPO_BUSQUEDA.test(firma)) { return true; }

    if (dentroDeLogin(el)) { return true; }
    return false;
  }

  /* ¿El campo tiene contenido de verdad? */
  function campoConContenido(el) {
    if (el.isContentEditable === true) {
      var texto = el.textContent || el.innerText || '';
      return texto.replace(/\s+/g, '') !== '';
    }
    var tipo = (el.type || '').toLowerCase();
    if (tipo === 'checkbox' || tipo === 'radio') { return !!el.checked; }
    var v = el.value;
    return typeof v === 'string' && v.replace(/\s+/g, '') !== '';
  }

  function marcarSucio(ev) {
    var el = ev && ev.target;
    if (campoExcluido(el)) { return; }
    if (campoConContenido(el)) { window.pgFormSucio = true; }
  }

  function limpiarSucio() {
    window.pgFormSucio = false;
  }

  /* Listener genérico a nivel document. Se instala en el primer uso. */
  function instalarDetectorFormularios() {
    if (detectorPuesto || !document.addEventListener) { return; }
    detectorPuesto = true;
    if (typeof window.pgFormSucio === 'undefined') { window.pgFormSucio = false; }

    document.addEventListener('input',  marcarSucio, true);
    document.addEventListener('change', marcarSucio, true);

    /* Al enviar un formulario: se limpia y, si había banner, entra el overlay. */
    document.addEventListener('submit', function () {
      limpiarSucio();
      if (hayBanner()) { forzarApertura('submit', 900); }
    }, true);

    /* Clic en un botón de guardar/enviar/registrar/crear/generar/actualizar. */
    document.addEventListener('click', function (ev) {
      var el = ev && ev.target, pasos = 0, txt;
      while (el && el.nodeType === 1 && pasos < 5) {
        var tag = el.tagName ? el.tagName.toUpperCase() : '';
        var esBoton = tag === 'BUTTON'
                   || (tag === 'INPUT' && /^(submit|button)$/i.test(el.type || ''))
                   || (el.getAttribute && el.getAttribute('role') === 'button');
        if (esBoton) {
          txt = (el.textContent || el.value || '') + ' ' + (el.id || '');
          if (RX_BOTON_GUARDAR.test(txt)) {
            limpiarSucio();
            if (hayBanner()) { forzarApertura('boton-guardar', 900); }
          }
          return;
        }
        el = el.parentNode; pasos++;
      }
    }, true);
  }

  /* --------------------------------------------------------------------- */
  /* 4. Banner rojo (bloqueo protegido)                                     */
  /* --------------------------------------------------------------------- */

  function quitarBanner() {
    if (timerBanner) { clearTimeout(timerBanner); timerBanner = null; }
    var b = document.getElementById('pgnovBanner');
    if (b && b.parentNode) { b.parentNode.removeChild(b); }
  }

  function mostrarBanner() {
    if (hayBanner() || hayOverlay() || !document.body) { return; }
    asegurarEstilos();

    var b = document.createElement('div');
    b.id = 'pgnovBanner';
    b.className = 'pgnov-banner';
    b.setAttribute('role', 'status');
    b.appendChild(nodo('span', 'msg',
      'Tienes una novedad pendiente — se abrirá cuando termines lo que estás haciendo'));
    var btn = nodo('button', null, 'Verla ahora');
    btn.type = 'button';
    btn.id = 'pgnovBannerBtn';
    b.appendChild(btn);
    document.body.appendChild(b);

    btn.addEventListener('click', function () { forzarApertura('boton-banner'); });

    /* A los 3 minutos entra el overlay pase lo que pase. */
    timerBanner = setTimeout(function () { forzarApertura('timeout-3min'); }, MS_BANNER_MAX);
    console.log('[pg-novedades] banner de novedad pendiente (hay trabajo a medias)');
  }

  /* Abre el overlay ya: quita el banner y vuelve a preguntarle a la RPC. */
  function forzarApertura(motivo, retrasoMs) {
    quitarBanner();
    if (hayOverlay()) { return; }
    console.log('[pg-novedades] abriendo overlay por: ' + motivo);
    setTimeout(function () {
      if (hayOverlay()) { return; }
      pedirPendientes(function (items) {
        var bloq = soloBloqueantes(items);
        if (!bloq.length) { return; }
        abrirOverlay(bloq, 'vivo');
      });
    }, retrasoMs || 0);
  }

  /* --------------------------------------------------------------------- */
  /* 5. Configuración de presentación (portal.novedades_config)             */
  /* --------------------------------------------------------------------- */
  /* Se lee UNA vez por página. Si la tabla, la fila o las columnas nuevas no
     existen todavía, se queda con los defaults (claro + persona + reparto).
     Esta función NUNCA propaga un error: el overlay tiene que abrir igual. */

  function aplicarConfig(fila) {
    if (!fila) { return; }
    try {
      if (fila.tema_overlay === 'oscuro' || fila.tema_overlay === 'claro') {
        CFG.tema = fila.tema_overlay;
      }
      if (fila.modo_ronda === 'mosaico' || fila.modo_ronda === 'persona') {
        CFG.modo = fila.modo_ronda;
      }
      var s = parseInt(fila.segundos_por_persona, 10);
      CFG.segPorPersona = (isFinite(s) && s > 0) ? s : null;
      if (fila.reacciones_activas === false) { CFG.reacciones = false; }
    } catch (e) { /* configuración rara: seguimos con los defaults */ }
  }

  function cargarConfig(cb) {
    if (cfgEstado === 2) { cb(); return; }
    cfgEnEspera.push(cb);
    if (cfgEstado === 1) { return; }
    cfgEstado = 1;

    function listo() {
      cfgEstado = 2;
      var pend = cfgEnEspera.slice();
      cfgEnEspera = [];
      pend.forEach(function (f) { try { f(); } catch (e) {} });
    }

    if (!cliente || typeof cliente.from !== 'function') { listo(); return; }
    try {
      cliente.from('novedades_config').select('*').limit(1).then(function (r) {
        if (r && r.error) {
          console.warn('[pg-novedades] novedades_config no disponible; se usan los valores por defecto', r.error);
        } else if (r && r.data && r.data.length) {
          aplicarConfig(r.data[0]);
        }
        console.log('[pg-novedades] presentación: tema ' + CFG.tema + ' · ronda ' + CFG.modo
          + ' · seg/persona ' + (CFG.segPorPersona === null ? 'repartido' : CFG.segPorPersona)
          + ' · reacciones ' + (CFG.reacciones ? 'on' : 'off'));
        listo();
      })['catch'](function (e) {
        console.warn('[pg-novedades] no se pudo leer novedades_config', e);
        listo();
      });
    } catch (e) {
      console.warn('[pg-novedades] no se pudo leer novedades_config', e);
      listo();
    }
  }

  /* --------------------------------------------------------------------- */
  /* 6. Consulta a la RPC — la RPC es la ÚNICA que decide qué se muestra    */
  /* --------------------------------------------------------------------- */

  /* Áreas a consultar. Con area fija (las 13 páginas) es esa y ya. Sin área
     (el portal: pgNovedadesAuto(null)) se pregunta novedades_mis_areas(); si
     esa RPC todavía no existe, se cae a 'general' y nada se rompe. */
  function areasEfectivas(cb) {
    if (areaActual) { cb([areaActual]); return; }
    if (areasCache) { cb(areasCache); return; }
    if (!cliente || typeof cliente.rpc !== 'function') { cb(['general']); return; }
    try {
      cliente.rpc('novedades_mis_areas').then(function (r) {
        var a = (r && !r.error && r.data && r.data.length) ? r.data.slice() : ['general'];
        if (r && r.error) { console.warn('[pg-novedades] novedades_mis_areas falló; se usa general', r.error); }
        areasCache = a;
        cb(a);
      })['catch'](function (e) {
        console.warn('[pg-novedades] novedades_mis_areas falló; se usa general', e);
        areasCache = ['general'];
        cb(areasCache);
      });
    } catch (e) {
      areasCache = ['general'];
      cb(areasCache);
    }
  }

  function pedirPendientes(cb, intento) {
    if (!cliente) { cb([]); return; }
    /* Si ya hay una consulta en vuelo, esperamos y reintentamos (hasta 5 veces). */
    if (window.__pgnovCorriendo) {
      intento = intento || 0;
      if (intento >= 5) { cb([]); return; }
      setTimeout(function () { pedirPendientes(cb, intento + 1); }, 400);
      return;
    }
    window.__pgnovCorriendo = true;

    areasEfectivas(function (areas) {
      var pendientes = areas.length, acumulado = [], vistos = {};

      function terminar() {
        window.__pgnovCorriendo = false;
        cb(acumulado);
      }
      function unaMenos(filas) {
        (filas || []).forEach(function (n) {
          var k = String(n && n.id);
          if (k && !vistos[k]) { vistos[k] = true; acumulado.push(n); }
        });
        pendientes--;
        if (pendientes <= 0) { terminar(); }
      }

      areas.forEach(function (ar) {
        try {
          cliente.rpc('novedades_pendientes', { p_area: ar }).then(function (r) {
            if (r && r.error) { console.warn('[pg-novedades] error en novedades_pendientes (' + ar + ')', r.error); }
            unaMenos((r && !r.error && r.data) ? r.data : []);
          })['catch'](function (e) {
            console.warn('[pg-novedades] fallo consultando pendientes (' + ar + ')', e);
            unaMenos([]);
          });
        } catch (e) { unaMenos([]); }
      });

      if (!areas.length) { terminar(); }
    });
  }

  /* §1.2 — bloqueante === false NO abre overlay: eso vive en el muro. */
  function soloBloqueantes(items) {
    return (items || []).filter(function (n) { return n && n.bloqueante !== false; });
  }

  /* Revisión general.
   * modo 'entrada' = la persona acaba de entrar  -> overlay inmediato.
   * modo 'vivo'    = la novedad llegó estando adentro -> bloqueo protegido. */
  function revisar(modo) {
    if (!cliente) { return; }
    if (hayOverlay()) { return; }
    if (modo === 'vivo' && hayBanner()) { return; } // ya avisamos, no repetimos
    if (!document.body) { return; }                 // aún no hay dónde pintar

    cargarConfig(function () {
      pedirPendientes(function (items) {
        var bloq = soloBloqueantes(items);
        if (items.length && !bloq.length) {
          console.log('[pg-novedades] ' + items.length
            + ' novedad(es) informativa(s): no abren overlay, quedan para el muro');
        }
        if (!bloq.length) { return; }
        if (hayOverlay()) { return; }
        if (modo === 'vivo' && window.pgFormSucio) {
          mostrarBanner();          // trabajo a medias -> primero avisamos
        } else {
          abrirOverlay(bloq, modo);
        }
      });
    });
  }

  /* --------------------------------------------------------------------- */
  /* 7. Reacciones (portal.novedades_reacciones)                            */
  /* --------------------------------------------------------------------- */

  function correoActual(cb) {
    if (correoCache !== null) { cb(correoCache); return; }
    if (!cliente || !cliente.auth || typeof cliente.auth.getSession !== 'function') {
      correoCache = ''; cb(''); return;
    }
    try {
      cliente.auth.getSession().then(function (r) {
        var s = r && r.data && r.data.session;
        var mail = s && s.user && s.user.email;
        correoCache = mail ? String(mail).toLowerCase() : '';
        cb(correoCache);
      })['catch'](function () { correoCache = ''; cb(''); });
    } catch (e) { correoCache = ''; cb(''); }
  }

  /* Conteos de UNA novedad (el muro tiene su propia RPC; aquí basta un select). */
  function conteosDe(id, cb) {
    if (!cliente || typeof cliente.from !== 'function') { cb(null); return; }
    try {
      cliente.from('novedades_reacciones').select('emoji,user_email')
        .eq('novedad_id', id).then(function (r) {
          if (!r || r.error || !r.data) { cb(null); return; }
          cb(r.data);
        })['catch'](function () { cb(null); });
    } catch (e) { cb(null); }
  }

  /* --------------------------------------------------------------------- */
  /* 8. Overlay lector v4 — una novedad (o un lote) = una pantalla completa  */
  /* --------------------------------------------------------------------- */

  function abrirOverlay(listaCruda, modo) {
    if (!listaCruda || !listaCruda.length || hayOverlay() || !document.body) { return; }
    asegurarEstilos();
    quitarBanner();

    var CLARO   = CFG.tema === 'claro';
    var items   = ordenar(listaCruda.slice());

    /* --- §3.1 / §3.1-B: de filas a PANTALLAS -------------------------------
       modo_ronda='mosaico' -> las felicitaciones del mismo lote_id son UNA
       pantalla con mosaico. modo_ronda='persona' (default) -> cada fila es su
       propia pantalla, en el orden en que vinieron (created_at de la RPC). */
    function armarPantallas(filas) {
      var pants = [], porLote = {};
      filas.forEach(function (n) {
        var lote = n.lote_id;
        if (CFG.modo === 'mosaico' && lote && tipoDe(n) === 'felicitacion') {
          if (porLote[lote]) { porLote[lote].filas.push(n); return; }
          var p = { filas: [n], lote: lote, mosaico: true };
          porLote[lote] = p;
          pants.push(p);
          return;
        }
        pants.push({ filas: [n], lote: lote || null, mosaico: false });
      });
      return pants;
    }

    var pantallas = armarPantallas(items);
    var actual  = 0;      // índice de la PANTALLA que se está mostrando
    var leidas  = {};     // ids ya confirmados en esta cola
    var tick    = null;   // intervalo del contador de la pantalla actual
    var restante= 0;      // segundos que le faltan a ESTA pantalla
    var segsPant= 0;      // segundos totales de ESTA pantalla
    var confirmando = false;

    function pantalla()  { return pantallas[actual]; }
    function principal() { var p = pantalla(); return p ? p.filas[0] : null; }

    /* El bloqueo aplica si alguna es bloqueante (aquí siempre lo son: la cola
       ya viene filtrada), pero el guardián se conserva por seguridad. */
    var bloquea = items.some(function (n) { return n.bloqueante !== false; });

    /* Total configurado = el mayor segundos_lectura de las bloqueantes. */
    var totalConfig = 0;
    items.forEach(function (n) {
      var s = parseInt(n.segundos_lectura, 10);
      if (n.bloqueante !== false && s > totalConfig) { totalConfig = s; }
    });
    if (bloquea && !totalConfig) { totalConfig = SEG_POR_DEFECTO; }

    /* Segundos por PANTALLA. Se calcula UNA sola vez al abrir la cola:
         - segundos_por_persona en Ajustes  -> ese valor, tal cual;
         - null                             -> total ÷ nº de pantallas, mín 15 s. */
    var SEG_PANTALLA = 0;
    if (bloquea) {
      SEG_PANTALLA = (CFG.segPorPersona !== null)
        ? CFG.segPorPersona
        : Math.max(SEG_MINIMO, Math.round(totalConfig / (pantallas.length || 1)));
    }

    /* El tiempo es POR PANTALLA, no repartido entre todas (Andrés, 4-sep):
       cada novedad manda con su propio segundos_lectura, así un comunicado
       largo puede durar lo que se le ponga aunque salga junto a otros de 5 s.
       Si la fila no trae valor propio, cae al de Ajustes. */
    function segundosDe(i) {
      var p = pantallas[i];
      if (!p || !bloquea) { return 0; }
      var todasInfo = p.filas.every(function (n) { return n.bloqueante === false; });
      if (todasInfo) { return 0; }
      var propio = 0;
      p.filas.forEach(function (n) {
        if (n.bloqueante === false) { return; }
        var s = parseInt(n.segundos_lectura, 10);
        if (isFinite(s) && s > propio) { propio = s; }   // en un lote manda el mayor de la pantalla
      });
      if (propio > 0) { return Math.max(SEG_MINIMO, propio); }
      return SEG_PANTALLA;
    }

    function tragaEscape(ev) {
      if (ev.key === 'Escape' || ev.keyCode === 27) { ev.preventDefault(); ev.stopImmediatePropagation(); }
    }
    function fondo(on) {
      try {
        document.documentElement.style.overflow = on ? 'hidden' : '';
        document.body.style.overflow = on ? 'hidden' : '';
      } catch (e) {}
    }

    /* ---------------- Esqueleto (se pinta una sola vez) ----------------
       Se arma con createElement (nada de innerHTML) para no dejar ninguna
       puerta abierta a datos de la base dentro del markup. */

    var ov = document.createElement('div');
    ov.id = 'pgnovOv';
    ov.className = 'pgnov-ov';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');

    var confeti = nodo('div', 'pgnov-confeti');
    confeti.setAttribute('aria-hidden', 'true');
    ov.appendChild(confeti);

    /* Barra superior blanca del tema claro (GABI | NOVEDADES · n de N + píldora) */
    var ovtop   = nodo('div', 'pgnov-ovtop');
    var ovtopIn = nodo('div', 'pgnov-ovtop-in');
    var marca   = nodo('div', 'pgnov-brand');
    marca.appendChild(nodo('span', 'pgnov-gabi', 'GABI'));
    marca.appendChild(nodo('span', 'pgnov-sep'));
    var secTxt  = nodo('span', 'pgnov-sec', 'Novedades ·');
    var secNum  = nodo('span', 'pgnov-secn', '');
    secTxt.appendChild(secNum);
    marca.appendChild(secTxt);
    var pill    = nodo('span', 'pgnov-cdpill');
    var pillNum = nodo('b', null, '');
    var pillTxt = nodo('small', null, 'para continuar');
    pill.appendChild(pillNum);
    pill.appendChild(pillTxt);
    ovtopIn.appendChild(marca);
    ovtopIn.appendChild(pill);
    ovtop.appendChild(ovtopIn);
    ov.appendChild(ovtop);

    var slide = nodo('div', 'pgnov-slide');

    /* Cabecera del tema oscuro (kicker + puntos) */
    var top = nodo('header', 'pgnov-top');
    top.appendChild(nodo('div', 'pgnov-kicker', 'Novedades · ProtectGo'));
    var prog = nodo('div', 'pgnov-prog');
    var dots = nodo('span', 'pgnov-dots');
    var cuenta = nodo('span', 'pgnov-count', '');
    prog.appendChild(dots);
    prog.appendChild(cuenta);
    top.appendChild(prog);
    slide.appendChild(top);

    var cuerpo = nodo('main', 'pgnov-body');
    slide.appendChild(cuerpo);

    var pie = nodo('footer', 'pgnov-bot');
    /* En el tema claro los puntos van en el pie (como la maqueta aprobada). */
    var progAbajo = nodo('div', 'pgnov-prog');
    var dotsAbajo = nodo('span', 'pgnov-dots');
    progAbajo.appendChild(dotsAbajo);
    pie.appendChild(progAbajo);
    var pausa = nodo('div', 'pgnov-pausa',
      'Contador detenido — vuelve a esta ventana para que siga corriendo');
    pie.appendChild(pausa);
    var barra = nodo('div', 'pgnov-bar');
    var fill  = nodo('i', null);
    barra.appendChild(fill);
    pie.appendChild(barra);
    var btn = nodo('button', 'pgnov-btn', 'Ya lo leí, entendido');
    btn.type = 'button';
    btn.id = 'pgnovBtn';
    pie.appendChild(btn);
    var reacBox = nodo('div', 'pgnov-reac');
    reacBox.hidden = true;
    pie.appendChild(reacBox);
    var nota = nodo('div', 'pgnov-note', '');
    pie.appendChild(nota);
    var enlace = nodo('a', 'pgnov-link', 'Ver en el portal →');
    enlace.target = '_blank';
    enlace.rel = 'noopener';
    enlace.hidden = true;
    pie.appendChild(enlace);

    slide.appendChild(pie);
    ov.appendChild(slide);
    document.body.appendChild(ov);

    /* Qué barra manda según el tema */
    ovtop.hidden = !CLARO;
    top.hidden = CLARO;
    progAbajo.hidden = !CLARO;

    fondo(bloquea);
    document.addEventListener('keydown', tragaEscape, true);

    /* ---------------- Piezas de contenido ---------------- */

    function bloqueFoto(n, claseCaja) {
      if (!n.imagen_url) { return null; }
      var caja = nodo('div', claseCaja);
      var img = document.createElement('img');
      img.alt = n.pie_foto || n.titulo || '';
      /* eager: el overlay bloquea la pantalla y la foto ES el contenido. Con 'lazy',
         si el contenedor arranca colapsado el navegador nunca dispara la carga. */
      img.loading = 'eager';
      img.decoding = 'async';
      img.onerror = function () {
        /* Foto rota: se retira la caja y, en felicitación, el nombre crece. */
        if (caja.parentNode) { caja.parentNode.removeChild(caja); }
        var cont = ov.querySelector('.pgnov-in');
        var p = principal();
        if (cont && p && tipoDe(p) === 'felicitacion') { cont.classList.add('sin-foto'); }
      };
      img.src = n.imagen_url;
      caja.appendChild(img);
      return caja;
    }

    /* Foto cuadrada con anillo menta, o iniciales si no hay foto. */
    function retrato(n, claseFoto, claseIni) {
      if (n.imagen_url) {
        var caja = nodo('div', claseFoto);
        var img = document.createElement('img');
        img.alt = n.titulo || '';
        /* eager: el overlay bloquea la pantalla y la foto ES el contenido. Con 'lazy',
         si el contenedor arranca colapsado el navegador nunca dispara la carga. */
      img.loading = 'eager';
      img.decoding = 'async';
        img.onerror = function () {
          var ini = nodo('div', claseIni, iniciales(n.titulo));
          ini.setAttribute('aria-label', n.titulo || '');
          if (caja.parentNode) { caja.parentNode.replaceChild(ini, caja); }
        };
        img.src = n.imagen_url;
        caja.appendChild(img);
        return caja;
      }
      var ini = nodo('div', claseIni, iniciales(n.titulo));
      ini.setAttribute('aria-label', n.titulo || '');
      return ini;
    }

    /* Escribe texto con **acentos** en dorado, sin innerHTML. Las cifras de
       cada tramo salen en mono (v4.1), también dentro del acento. */
    function pintarConAcento(elemento, texto) {
      var partes = String(texto).split('**');
      var i, s;
      for (i = 0; i < partes.length; i++) {
        if (partes[i] === '') { continue; }
        if (i % 2 === 1) {
          s = document.createElement('strong');
          s.className = 'pgnov-ens-acento';
          pintarCifras(s, partes[i]);
          elemento.appendChild(s);
        } else {
          pintarCifras(elemento, partes[i]);
        }
      }
    }

    /* Bloque opcional "Enseñanza del mes": disponible en cualquier tipo. */
    function bloqueEnsenanza(texto) {
      var caja = nodo('div', 'pgnov-ens');
      caja.appendChild(nodo('span', 'pgnov-ens-badge', 'Enseñanza del mes'));
      var p = nodo('p', 'pgnov-ens-texto');
      pintarConAcento(p, texto);
      caja.appendChild(p);
      return caja;
    }

    function insignia(texto, emoji) {
      var b = nodo('span', 'pgnov-badge');
      if (emoji) { b.appendChild(nodo('span', 'em', emoji)); }
      b.appendChild(document.createTextNode(texto));
      return b;
    }

    function armarConfeti(encender) {
      vaciar(confeti);
      if (!encender) { return; }
      var colores = CLARO
        ? ['#2DBFA3', '#D9A520', '#5B6BD6', '#229A82']
        : ['#2DBFA3', '#D9A520', '#FFFFFF', '#5B6BD6', '#229A82'];
      var N = CLARO ? 9 : 14, i, p;
      for (i = 0; i < N; i++) {
        p = document.createElement('i');
        p.style.left = ((i * (96 / N)) + 2 + (i % 3) * 1.6).toFixed(1) + '%';
        p.style.background = colores[i % colores.length];
        p.style.animationDuration = (6 + (i % 5) * 1.3).toFixed(2) + 's';
        p.style.animationDelay = (-(i % 7) * 1.2).toFixed(2) + 's';
        confeti.appendChild(p);
      }
    }

    function pintarProgreso() {
      var i, d, e;
      [dots, dotsAbajo].forEach(function (cont) {
        vaciar(cont);
        for (i = 0; i < pantallas.length; i++) {
          d = document.createElement('i');
          if (i < actual) { d.className = 'done'; }
          else if (i === actual) { d.className = 'on'; }
          cont.appendChild(d);
        }
      });
      /* "1 de 5": los DOS números en mono y el "de" en la fuente de texto
         (regla del estándar). Se arma con nodos, nunca con innerHTML. */
      function contador(destino, conEspacio) {
        vaciar(destino);
        if (conEspacio) { destino.appendChild(document.createTextNode(' ')); }
        destino.appendChild(nodo('span', 'num', String(actual + 1)));
        destino.appendChild(document.createTextNode(' de '));
        destino.appendChild(nodo('span', 'num', String(pantallas.length)));
      }
      contador(cuenta, false);
      /* Con una sola pantalla el "1 de 1" sobra en la barra clara. */
      if (pantallas.length > 1) {
        secTxt.firstChild.nodeValue = 'Novedades ·';
        contador(secNum, true);
      } else {
        secTxt.firstChild.nodeValue = 'Novedades';
        vaciar(secNum);
      }
      /* Con una sola pantalla los puntos sobran. */
      e = pantallas.length > 1;
      dots.hidden = !e;
      dotsAbajo.hidden = !e;
      cuenta.hidden = !e;
    }

    /* --- Pantalla de UNA persona (modo_ronda = persona, §3.1-B) --- */
    function bloquePersona(n) {
      var caja = nodo('div', 'pgnov-per');
      caja.appendChild(insignia('Felicitación', TIPOS.felicitacion.e));
      caja.appendChild(retrato(n, 'pgnov-per-foto', 'pgnov-per-ini'));
      caja.appendChild(nodo('div', 'pgnov-per-nom', n.titulo || ''));
      if (n.logro) { caja.appendChild(nodo('span', 'pgnov-per-logro', n.logro)); }
      if (n.cuerpo && /[a-z0-9]/i.test(n.cuerpo)) { caja.appendChild(parrafo('p', 'pgnov-per-cue', n.cuerpo)); }
      if (n.pie_foto) { caja.appendChild(parrafo('div', 'pgnov-pie', n.pie_foto)); }
      if (n.ensenanza) { caja.appendChild(bloqueEnsenanza(n.ensenanza)); }
      return caja;
    }

    /* --- Pantalla-mosaico de un lote (modo_ronda = mosaico, §3.1) --- */
    function tarjetaMosaico(n) {
      var c = nodo('div', 'pgnov-mos-card');
      c.appendChild(retrato(n, 'pgnov-mos-foto', 'pgnov-mos-ini'));
      var t = nodo('div', 'pgnov-mos-txt');
      t.appendChild(nodo('div', 'pgnov-mos-nom', n.titulo || ''));
      if (n.logro) { t.appendChild(nodo('div', 'pgnov-mos-logro', n.logro)); }
      if (n.cuerpo && /[a-z0-9]/i.test(n.cuerpo)) { t.appendChild(parrafo('p', 'pgnov-mos-cue', n.cuerpo)); }
      c.appendChild(t);
      return c;
    }

    function pintarCuerpo() {
      var p = pantalla();
      if (!p) { return; }
      var n = p.filas[0], t = tipoDe(n), meta = TIPOS[t];
      ov.className = 'pgnov-ov t-' + t + (CLARO ? ' claro' : '');
      armarConfeti(t === 'felicitacion');

      var caja = nodo('div', 'pgnov-in');
      vaciar(cuerpo);

      if (t === 'felicitacion' && p.mosaico && p.filas.length > 1) {
        /* Ronda completa en una sola pantalla. */
        caja.appendChild(insignia('Felicitaciones de la semana', meta.e));
        /* "5 personas": el número en mono, la palabra en Inter (regla del
           estándar: TODOS los números en JetBrains Mono, el texto no). */
        var sub = nodo('div', 'pgnov-sub');
        sub.appendChild(nodo('span', 'pgnov-num', String(p.filas.length)));
        sub.appendChild(document.createTextNode(' personas'));
        caja.appendChild(sub);
        var grid = nodo('div', 'pgnov-mos' + (p.filas.length >= 4 ? ' denso' : ''));
        p.filas.forEach(function (f) { grid.appendChild(tarjetaMosaico(f)); });
        caja.appendChild(grid);

      } else if (t === 'felicitacion' && (n.logro || CFG.modo === 'persona')) {
        /* Una persona por pantalla (lo aprobado por Andrés). */
        var per = bloquePersona(n);
        caja.appendChild(CLARO ? envolverPanel(per) : per);

      } else if (t === 'felicitacion') {
        /* Felicitación clásica del v3 (tarjeta héroe con foto grande). */
        var foto = bloqueFoto(n, 'pgnov-fel-foto');
        if (!foto) { caja.classList.add('sin-foto'); }
        caja.appendChild(insignia(meta.n, meta.e));
        if (foto) { caja.appendChild(foto); }
        caja.appendChild(nodo('h2', 'pgnov-tit', n.titulo || ''));
        if (n.cuerpo && /[a-z0-9]/i.test(n.cuerpo)) { caja.appendChild(parrafo('p', 'pgnov-cue', n.cuerpo)); }
        if (n.pie_foto) { caja.appendChild(parrafo('div', 'pgnov-pie', n.pie_foto)); }
        if (n.ensenanza) { caja.appendChild(bloqueEnsenanza(n.ensenanza)); }

      } else if (t === 'aviso') {
        var marco = nodo('div', 'pgnov-marco');
        marco.appendChild(nodo('span', 'pgnov-enc', 'Aviso importante'));
        marco.appendChild(nodo('h2', 'pgnov-tit', n.titulo || ''));
        var fa = bloqueFoto(n, 'pgnov-foto');
        if (fa) { marco.appendChild(fa); }
        if (n.cuerpo && /[a-z0-9]/i.test(n.cuerpo)) { marco.appendChild(parrafo('p', 'pgnov-cue', n.cuerpo)); }
        if (n.pie_foto) { marco.appendChild(parrafo('div', 'pgnov-pie', n.pie_foto)); }
        if (n.ensenanza) { marco.appendChild(bloqueEnsenanza(n.ensenanza)); }
        caja.appendChild(marco);

      } else if (t === 'novedad') {
        var tar = nodo('div', 'pgnov-nov');
        tar.appendChild(insignia(meta.n + (n.area ? ' · ' + String(n.area).toUpperCase() : ''), ''));
        tar.appendChild(nodo('h2', 'pgnov-tit', n.titulo || ''));
        var fn = bloqueFoto(n, 'pgnov-foto');
        if (fn) { tar.appendChild(fn); }
        if (n.cuerpo && /[a-z0-9]/i.test(n.cuerpo)) { tar.appendChild(parrafo('p', 'pgnov-cue', n.cuerpo)); }
        if (n.pie_foto) { tar.appendChild(parrafo('div', 'pgnov-pie', n.pie_foto)); }
        if (n.ensenanza) { tar.appendChild(bloqueEnsenanza(n.ensenanza)); }
        caja.appendChild(tar);

      } else {
        var rec = CLARO ? nodo('div', 'pgnov-panel') : caja;
        rec.appendChild(insignia(meta.n, ''));
        rec.appendChild(nodo('h2', 'pgnov-tit', n.titulo || ''));
        var fr = bloqueFoto(n, 'pgnov-foto');
        if (fr) { rec.appendChild(fr); }
        if (n.cuerpo && /[a-z0-9]/i.test(n.cuerpo)) { rec.appendChild(parrafo('p', 'pgnov-cue', n.cuerpo)); }
        if (n.pie_foto) { rec.appendChild(parrafo('div', 'pgnov-pie', n.pie_foto)); }
        if (n.ensenanza) { rec.appendChild(bloqueEnsenanza(n.ensenanza)); }
        if (rec !== caja) { caja.appendChild(rec); }
      }

      cuerpo.appendChild(caja);
      cuerpo.scrollTop = 0;
    }

    function envolverPanel(hijo) {
      var p = nodo('div', 'pgnov-panel');
      p.appendChild(hijo);
      return p;
    }

    /* ---------------- Contador ---------------- */

    function textoBotonListo() {
      return (actual < pantallas.length - 1) ? 'Ya lo leí, siguiente →' : 'Ya lo leí, entendido';
    }

    function textoNota() {
      var faltan = pantallas.length - actual - 1;
      if (faltan <= 0) { return ''; }
      return faltan === 1 ? 'Después de esta te queda 1 más.'
                          : 'Después de esta te quedan ' + faltan + ' más.';
    }

    function leyendo() {
      try { return document.visibilityState === 'visible' && document.hasFocus(); }
      catch (e) { return document.visibilityState === 'visible'; }
    }

    /* Botón "Podrás continuar en M:SS" con el número en JetBrains Mono. */
    function botonContando(seg) {
      vaciar(btn);
      btn.appendChild(document.createTextNode('Podrás continuar en '));
      btn.appendChild(nodo('b', 'num', mmss(seg)));
    }

    function pintaContador() {
      if (!segsPant) { return; }
      botonContando(restante);
      pillNum.textContent = mmss(restante);
      pillTxt.textContent = 'para continuar';
      pill.className = 'pgnov-cdpill';
      fill.style.width = Math.round(((segsPant - restante) / segsPant) * 100) + '%';
      var quieto = !leyendo();
      pausa.style.display = quieto ? 'block' : 'none';
      nota.textContent = quieto ? '' : 'El contador solo avanza mientras estés en esta ventana.';
    }

    function liberarBoton() {
      if (tick) { clearInterval(tick); tick = null; }
      restante = 0;
      fill.style.width = '100%';
      pausa.style.display = 'none';
      btn.disabled = false;
      vaciar(btn);
      btn.textContent = textoBotonListo();
      nota.textContent = textoNota();
      pillNum.textContent = '0:00';
      pillTxt.textContent = 'lectura completa';
      pill.className = 'pgnov-cdpill ok';
      mostrarPie();
    }

    function arrancarContador() {
      if (tick) { clearInterval(tick); tick = null; }
      segsPant = segundosDe(actual);
      if (!segsPant) {                       // sin contador
        barra.hidden = true;
        pausa.style.display = 'none';
        btn.disabled = false;
        vaciar(btn);
        btn.textContent = textoBotonListo();
        nota.textContent = textoNota();
        pillNum.textContent = '0:00';
        pillTxt.textContent = 'lectura completa';
        pill.className = 'pgnov-cdpill ok';
        mostrarPie();
        return;
      }
      barra.hidden = false;
      restante = segsPant;
      btn.disabled = true;
      esconderPie();
      pintaContador();
      tick = setInterval(function () {
        if (!leyendo()) { pintaContador(); return; }   // pestaña quieta: no corre
        restante--;
        if (restante <= 0) { liberarBoton(); return; }
        pintaContador();
      }, 1000);
    }

    /* ---------------- Pie: reacciones + enlace al muro ---------------- */

    function esconderPie() {
      reacBox.hidden = true;
      enlace.hidden = true;
    }

    /* Se muestran cuando el contador libera el botón (§3.1). */
    function mostrarPie() {
      var n = principal();
      if (!n) { return; }
      enlace.href = URL_MURO + encodeURIComponent(String(n.id));
      enlace.hidden = false;
      if (!CFG.reacciones) { reacBox.hidden = true; return; }
      pintarReacciones(n);
    }

    function pintarReacciones(n) {
      vaciar(reacBox);
      reacBox.hidden = false;
      reacBox.className = 'pgnov-reac';
      var botones = {};
      EMOJIS.forEach(function (em) {
        var b = nodo('button', 'pgnov-rx');
        b.type = 'button';
        b.setAttribute('aria-label', 'Reaccionar ' + em);
        b.appendChild(nodo('span', null, em));
        var c = nodo('span', 'n', '0');
        b.appendChild(c);
        b.addEventListener('click', function () { alternar(n, em, b, c); });
        botones[em] = { b: b, c: c };
        reacBox.appendChild(b);
      });
      refrescarConteos(n, botones);
    }

    function refrescarConteos(n, botones) {
      correoActual(function (mail) {
        conteosDe(n.id, function (filas) {
          if (!filas) { reacBox.className = 'pgnov-reac off'; return; }  // inertes, sin romper
          var cuenta = {};
          var mias = {};
          filas.forEach(function (f) {
            cuenta[f.emoji] = (cuenta[f.emoji] || 0) + 1;
            if (mail && String(f.user_email).toLowerCase() === mail) { mias[f.emoji] = true; }
          });
          EMOJIS.forEach(function (em) {
            var par = botones[em];
            if (!par) { return; }
            par.c.textContent = String(cuenta[em] || 0);
            par.b.className = 'pgnov-rx' + (mias[em] ? ' mia' : '');
          });
        });
      });
    }

    /* Un clic agrega, otro quita. Si falla, las reacciones quedan inertes. */
    function alternar(n, emoji, boton, contador) {
      if (!cliente || typeof cliente.from !== 'function') { return; }
      correoActual(function (mail) {
        if (!mail) { reacBox.className = 'pgnov-reac off'; return; }
        var eraMia = boton.className.indexOf('mia') >= 0;
        var fila = { novedad_id: n.id, user_email: mail, emoji: emoji };
        /* Pintado optimista: se corrige con el refresco de conteos. */
        var v = parseInt(contador.textContent, 10) || 0;
        contador.textContent = String(Math.max(0, eraMia ? v - 1 : v + 1));
        boton.className = 'pgnov-rx' + (eraMia ? '' : ' mia');

        function alFallar(e) {
          console.warn('[pg-novedades] no se pudo registrar la reacción', e);
          reacBox.className = 'pgnov-reac off';
        }
        function alTerminar(r) {
          if (r && r.error) { alFallar(r.error); return; }
          var botones = {};
          EMOJIS.forEach(function (em) {
            var b = reacBox.querySelector('[aria-label="Reaccionar ' + em + '"]');
            if (b) { botones[em] = { b: b, c: b.querySelector('.n') }; }
          });
          refrescarConteos(n, botones);
        }
        try {
          if (eraMia) {
            cliente.from('novedades_reacciones')['delete']().match(fila)
              .then(alTerminar)['catch'](alFallar);
          } else {
            cliente.from('novedades_reacciones').insert(fila)
              .then(alTerminar)['catch'](alFallar);
          }
        } catch (e) { alFallar(e); }
      });
    }

    /* Pinta la pantalla 'actual' completa (progreso + cuerpo + contador). */
    function pintarPantalla(conTransicion) {
      function hacer() {
        pintarProgreso();
        pintarCuerpo();
        arrancarContador();
        slide.classList.remove('saliendo');
        slide.classList.add('entrando');
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { slide.classList.remove('entrando'); });
        });
      }
      if (conTransicion) {
        slide.classList.add('saliendo');
        setTimeout(hacer, MS_TRANSICION);
      } else {
        hacer();
      }
    }

    /* ---------------- Cierre y retiro en caliente ---------------- */

    function cerrarTodo() {
      if (tick) { clearInterval(tick); tick = null; }
      if (ov && ov.parentNode) { ov.parentNode.removeChild(ov); }
      fondo(false);
      document.removeEventListener('keydown', tragaEscape, true);
      ['blur', 'focus'].forEach(function (ev) { window.removeEventListener(ev, alCambiarFoco, true); });
      document.removeEventListener('visibilitychange', alCambiarFoco, true);
      estadoOv = null;
      /* Igual que el v2/v3: NUNCA se navega al cerrar. */
    }

    /* La desactivaron mientras la cola estaba abierta (lo detecta el respaldo
       de 60 s). Una novedad YA LEÍDA no se quita. */
    function quitarNovedad(id) {
      if (leidas[String(id)]) { return; }
      var idxP = -1, idxF = -1, i, j;
      for (i = 0; i < pantallas.length && idxP < 0; i++) {
        for (j = 0; j < pantallas[i].filas.length; j++) {
          if (String(pantallas[i].filas[j].id) === String(id)) { idxP = i; idxF = j; break; }
        }
      }
      if (idxP < 0) { return; }

      pantallas[idxP].filas.splice(idxF, 1);
      if (pantallas[idxP].filas.length) {
        /* Era una de varias en un mosaico: la pantalla sigue viva. */
        if (idxP === actual) { pintarCuerpo(); }
        return;
      }
      pantallas.splice(idxP, 1);
      if (!pantallas.length) { cerrarTodo(); return; }

      if (idxP < actual) {
        actual--;
        pintarProgreso();
      } else if (idxP === actual) {
        if (actual >= pantallas.length) { cerrarTodo(); return; }
        pintarPantalla(true);
      } else {
        pintarProgreso();
        if (!btn.disabled) {
          vaciar(btn);
          btn.textContent = textoBotonListo();
          nota.textContent = textoNota();
        }
      }
    }

    estadoOv = {
      quitar: quitarNovedad,
      cerrar: cerrarTodo,
      /* Solo los ids que la persona AÚN no ha confirmado. */
      ids: function () {
        var out = [];
        pantallas.forEach(function (p) {
          p.filas.forEach(function (n) {
            if (!leidas[String(n.id)]) { out.push(String(n.id)); }
          });
        });
        return out;
      },
      /* Diagnóstico: cómo quedó repartida la cola. */
      info: function () {
        return {
          tema: CFG.tema, modo: CFG.modo,
          pantallas: pantallas.length,
          segPorPantalla: SEG_PANTALLA,
          actual: actual + 1
        };
      }
    };

    /* ---------------- Confirmar y avanzar ---------------- */

    btn.addEventListener('click', function () {
      if (btn.disabled || confirmando) { return; }
      var p = pantalla();
      if (!p || !p.filas.length) { return; }

      confirmando = true;
      btn.disabled = true;
      vaciar(btn);
      btn.textContent = 'Guardando…';

      /* Se marca leída CADA fila mostrada en la pantalla (una en modo persona,
         N en el mosaico de un lote). marcar_novedad_leida ya es idempotente. */
      var filas = p.filas.slice(), pendientes = filas.length, hubo = false;
      filas.forEach(function (n) {
        try {
          cliente.rpc('marcar_novedad_leida', { p_novedad_id: n.id }).then(function (r) {
            if (r && r.error) { hubo = true; }
            listo();
          })['catch'](function () { hubo = true; listo(); });
        } catch (e) { hubo = true; listo(); }
      });

      function listo() {
        pendientes--;
        if (pendientes > 0) { return; }
        confirmando = false;
        if (hubo) { falloAlGuardar(); return; }
        avanzar(filas);
      }
    });

    function falloAlGuardar() {
      btn.disabled = false;
      vaciar(btn);
      btn.textContent = 'Reintentar';
      nota.textContent = 'No se pudo registrar la lectura. Revisa tu conexión e inténtalo otra vez.';
    }

    /* Deja marcadas las que se acaban de leer y pasa a la siguiente pantalla.
       La cola NO se encoge: el indicador va 1 de 5 → 2 de 5 → … */
    function avanzar(filas) {
      filas.forEach(function (n) { leidas[String(n.id)] = true; });
      actual++;
      if (actual >= pantallas.length) { cerrarTodo(); return; }
      pintarPantalla(true);
    }

    /* ---------------- Foco / visibilidad ---------------- */

    function alCambiarFoco() {
      if (restante > 0) { pintaContador(); }
    }
    ['blur', 'focus'].forEach(function (ev) { window.addEventListener(ev, alCambiarFoco, true); });
    document.addEventListener('visibilitychange', alCambiarFoco, true);

    /* ---------------- Arranque ---------------- */

    pintarPantalla(false);
    console.log('[pg-novedades] cola abierta: ' + pantallas.length + ' pantalla(s) de '
      + items.length + ' novedad(es) · tema ' + CFG.tema + ' · ronda ' + CFG.modo
      + ' · ' + SEG_PANTALLA + ' s por pantalla · modo ' + modo);
  }

  /* --------------------------------------------------------------------- */
  /* 9. Tiempo real (postgres_changes)                                     */
  /* --------------------------------------------------------------------- */

  /* Agrupa ráfagas de eventos: si llegan varios seguidos, una sola revisión. */
  function revisarConDebounce() {
    if (timerDebounce) { clearTimeout(timerDebounce); }
    timerDebounce = setTimeout(function () {
      timerDebounce = null;
      revisar('vivo');
    }, MS_DEBOUNCE);
  }

  function alRecibirEvento(payload) {
    try {
      var fila = payload && (payload["new"] || payload.record);
      var tipoEv = payload && (payload.eventType || payload.type);
      /* OJO — esta rama casi nunca se dispara en producción, y es esperado:
         portal.novedades tiene RLS de lectura (activo = true) y Realtime la
         respeta, así que el UPDATE de "la bajaron" no le llega al usuario.
         Quien de verdad cierra en caliente la novedad bajada es el respaldo
         de 60 s (revisarOverlayAbierto, sección 10). Se deja por si algún día
         SÍ llega el evento. El RUTEO POR ÁREA lo sigue decidiendo la RPC. */
      if (fila && tipoEv === 'UPDATE' && fila.activo === false && estadoOv) {
        estadoOv.quitar(fila.id);
      }
    } catch (e) { /* nunca dejamos que un payload raro tumbe el widget */ }
    revisarConDebounce();
  }

  function arrancarTiempoReal() {
    if (window.__pgnovCanal) { return; }             // una sola suscripción por página
    if (!cliente || typeof cliente.channel !== 'function') {
      console.warn('[pg-novedades] este cliente de supabase-js no soporta realtime; queda solo el respaldo de 60 s');
      return;
    }
    var canal;
    try {
      canal = cliente.channel('pgnov-' + (areaActual || 'portal') + '-' + Math.random().toString(36).slice(2, 8))
        .on('postgres_changes', { event: 'INSERT', schema: 'portal', table: 'novedades' }, alRecibirEvento)
        .on('postgres_changes', { event: 'UPDATE', schema: 'portal', table: 'novedades' }, alRecibirEvento)
        .subscribe(function (estado) {
          console.log('[pg-novedades] canal realtime: ' + estado);
          if (estado === 'SUBSCRIBED') {
            resuscribiendo = false;
            revisarConDebounce();   // por si algo entró mientras el socket estaba caído
          }
          if (estado === 'CLOSED' || estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT') {
            reintentarSuscripcion();
          }
        });
      window.__pgnovCanal = canal;
    } catch (e) {
      console.warn('[pg-novedades] no se pudo abrir el canal realtime', e);
      window.__pgnovCanal = null;
    }
  }

  function reintentarSuscripcion() {
    if (resuscribiendo) { return; }
    resuscribiendo = true;
    setTimeout(function () {
      try {
        if (window.__pgnovCanal && cliente && typeof cliente.removeChannel === 'function') {
          cliente.removeChannel(window.__pgnovCanal);
        }
      } catch (e) {}
      window.__pgnovCanal = null;
      resuscribiendo = false;
      arrancarTiempoReal();
      revisar('vivo');
    }, MS_RESUSCRIBIR);
  }

  /* --------------------------------------------------------------------- */
  /* 10. Respaldo: timer de 60 s + volver a la pestaña + volver a internet  */
  /* --------------------------------------------------------------------- */

  /* Con la cola YA abierta, este es el que de verdad cierra en caliente una
     novedad que el admin bajó (activo=false) o que venció: cada 60 s vuelve a
     preguntarle a novedades_pendientes y retira de la cola lo que ya no venga.
     NUNCA abre una cola nueva (esa ruta es 'revisar') ni toca el banner. */
  function revisarOverlayAbierto() {
    if (!estadoOv) { return; }
    pedirPendientes(function (vivos) {
      if (!estadoOv) { return; } // se cerró mientras esperábamos la respuesta
      var idsVivos = {}, i;
      for (i = 0; i < vivos.length; i++) { idsVivos[String(vivos[i].id)] = true; }
      var idsCola = estadoOv.ids();
      for (i = 0; i < idsCola.length; i++) {
        if (!estadoOv) { break; } // la cola se vació a mitad de la vuelta
        if (!idsVivos[idsCola[i]]) { estadoOv.quitar(idsCola[i]); }
      }
    });
  }

  function arrancarRespaldo() {
    if (respaldoPuesto) { return; }
    respaldoPuesto = true;

    timerRespaldo = setInterval(function () {
      if (hayOverlay()) { revisarOverlayAbierto(); } else { revisar('vivo'); }
    }, MS_RESPALDO);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        revisarConDebounce();
        if (!window.__pgnovCanal) { arrancarTiempoReal(); }
      }
    });

    window.addEventListener('online', function () {
      revisarConDebounce();
      if (!window.__pgnovCanal) { arrancarTiempoReal(); }
    });
  }

  /* --------------------------------------------------------------------- */
  /* 11. API pública — MISMA FIRMA que el v1, el v2 y el v3                */
  /* --------------------------------------------------------------------- */

  window.pgRevisarNovedades = function (sbClient, area) {
    if (!sbClient) { return; }

    cliente = sbClient;
    /* v4: el área puede venir vacía (el portal). En ese caso se resuelve con
       rpc('novedades_mis_areas'); ver areasEfectivas(). */
    areaActual = area || null;
    asegurarEstilos();
    instalarDetectorFormularios();

    var ahora = (new Date()).getTime();
    if (!tPrimeraLlamada) { tPrimeraLlamada = ahora; }

    /* Las páginas llaman esto varias veces. Las llamadas de los primeros 30 s
       cuentan como "acaba de entrar" -> overlay inmediato. Las posteriores
       cuentan como "ya está adentro" -> bloqueo protegido. */
    var modo = (ahora - tPrimeraLlamada) < MS_VENTANA_ENTRADA ? 'entrada' : 'vivo';

    cargarConfig(function () {});
    arrancarTiempoReal();
    arrancarRespaldo();
    revisar(modo);
  };

  /* Gancho de prueba: fuerza una revisión "como si la novedad llegara ahora". */
  window.__pgnovProbarEnVivo = function () { revisar('vivo'); };

  /* Gancho de prueba: simula que el admin bajó una novedad con la cola abierta. */
  window.__pgnovBajar = function (id) { if (estadoOv) { estadoOv.quitar(id); } };

  /* Gancho de prueba: corre YA la pasada del respaldo de 60 s. */
  window.__pgnovRevisarCola = function () { revisarOverlayAbierto(); };

  /* Ganchos de auditoría en vivo (consola del navegador). */
  window.__pgnovDiag = function () {
    return {
      version: window.PG_NOVEDADES_VERSION,
      area: areaActual,
      areas: areasCache,
      config: { tema: CFG.tema, modo: CFG.modo, segPorPersona: CFG.segPorPersona, reacciones: CFG.reacciones },
      canal: !!window.__pgnovCanal,
      estadoCanal: window.__pgnovCanal && window.__pgnovCanal.state,
      formSucio: !!window.pgFormSucio,
      overlay: hayOverlay(),
      banner: hayBanner(),
      cola: estadoOv ? estadoOv.ids() : [],
      pantallas: estadoOv ? estadoOv.info() : null
    };
  };

  /* --------------------------------------------------------------------- */
  /* 12. Arranque automático (Módulo B) — window.pgNovedadesAuto(area)      */
  /* --------------------------------------------------------------------- */
  /* Problema que resuelve: pgRevisarNovedades necesita el cliente de
     supabase-js de la página, pero en las páginas nuevas ese cliente vive
     dentro de un closure y no está expuesto en window. En vez de tocar el
     código de cada página, este arranque crea su PROPIO cliente.

     REGLA DE ORO: este cliente NO puede dañar la sesión que ya guardó el
     login de la página. Por eso:
       - usa la MISMA gaveta (storageKey por defecto) para poder LEER la
         sesión, pero envuelta en un proxy de SOLO LECTURA: setItem y
         removeItem no hacen nada, así que jamás pisa ni borra el token;
       - autoRefreshToken:false  -> nunca refresca (refrescar escribiría);
       - detectSessionInUrl:false-> no lee ni limpia el hash de la URL;
       - nunca se llama signOut() ni setSession() desde aquí.
     Quien manda sobre la sesión sigue siendo el login de la página.

     OJO (regla "nada de almacenamiento local" del estándar): el widget NO
     guarda NADA suyo aquí. La única lectura de la gaveta del navegador es la
     de la sesión de supabase-js, y es de solo lectura. */

  var PGA_URL = 'https://hivpqsepwsfmafamxkzy.supabase.co';
  var PGA_KEY = 'sb_publishable_Kak00GbGVt2K3yGh6IBZvw_99IybVvt';
  var PGA_MS_SDK       = 250;    // cada cuánto revisamos si ya cargó supabase-js
  var PGA_MAX_SDK      = 40;     // 40 x 250 ms = 10 s de espera máxima
  var PGA_MS_SESION    = 5000;   // reintento mientras la persona no ha entrado
  var PGA_MS_TOKEN     = 60000;  // vigilancia del token (mismo ritmo del respaldo)
  var pgaTokenVisto    = null;   // último access_token que le conocimos a la sesión

  /* Gaveta compartida en modo SOLO LECTURA (la prueba anti-pisar-sesión). */
  function pgaGavetaSoloLectura() {
    var ls = null;
    try { ls = window.localStorage; } catch (e) { ls = null; }
    if (!ls) { return null; }
    /* Si la sesión guardada está vencida (o a punto), la escondemos: devolvemos
       null. Así supabase-js NUNCA intenta refrescarla desde este cliente —
       refrescar rota el refresh_token en el servidor y, como aquí no escribimos,
       el login de la página se quedaría con el token viejo y podría sacar a la
       persona. En cuanto el login de la página renueve, la volvemos a ver. */
    function vigente(v) {
      try {
        var o = JSON.parse(v);
        var s = (o && o.currentSession) ? o.currentSession : o;
        if (!s || !s.expires_at) { return true; }
        return (Number(s.expires_at) * 1000) > ((new Date()).getTime() + 60000);
      } catch (e) { return true; }   // no es JSON de sesión: pasa tal cual
    }
    return {
      getItem: function (k) {
        try { var v = ls.getItem(k); return (v && !vigente(v)) ? null : v; }
        catch (e) { return null; }
      },
      setItem: function () { /* a propósito no hace nada: no escribimos */ },
      removeItem: function () { /* a propósito no hace nada: no borramos */ }
    };
  }

  function pgaHaySDK() {
    return !!(window.supabase && typeof window.supabase.createClient === 'function');
  }

  /* Un solo cliente por página, pase lo que pase. */
  function pgaCliente() {
    if (window.__pgnovAutoCliente) { return window.__pgnovAutoCliente; }
    if (!pgaHaySDK()) { return null; }
    var opciones = { db: { schema: 'portal' }, auth: {
      persistSession: true,       // hace falta para LEER la gaveta compartida
      autoRefreshToken: false,    // no refresca -> no escribe
      detectSessionInUrl: false   // no toca la URL
    } };
    var gaveta = pgaGavetaSoloLectura();
    if (gaveta) { opciones.auth.storage = gaveta; }
    try {
      window.__pgnovAutoCliente = window.supabase.createClient(PGA_URL, PGA_KEY, opciones);
    } catch (e) {
      console.warn('[pg-novedades] no se pudo crear el cliente automático', e);
      window.__pgnovAutoCliente = null;
    }
    return window.__pgnovAutoCliente;
  }

  function pgaDetenerReintento() {
    if (window.__pgnovAutoTimer) {
      clearInterval(window.__pgnovAutoTimer);
      window.__pgnovAutoTimer = null;
    }
  }

  /* setInterval ÚNICO: si ya hay uno programado no se crea otro. */
  function pgaProgramarReintento(area) {
    if (window.__pgnovAutoTimer) { return; }
    window.__pgnovAutoTimer = setInterval(function () {
      if (window.__pgnovAutoArrancado) { pgaDetenerReintento(); return; }
      pgaIntentar(area);
    }, PGA_MS_SESION);
  }

  /* Vigilancia del token (caso "se venció el JWT con la página abierta"):
       - Las RPC: supabase-js relee la gaveta en cada getSession(), así que el
         401 se cura solo en el siguiente ciclo del respaldo.
       - El realtime: el socket guarda el token con el que se conectó, así que
         ahí sí hay que avisarle con realtime.setAuth (no escribe en la gaveta). */
  function pgaVigilarToken() {
    if (window.__pgnovAutoTokenTimer) { return; }
    window.__pgnovAutoTokenTimer = setInterval(function () {
      var c = window.__pgnovAutoCliente;
      if (!c || !c.auth || typeof c.auth.getSession !== 'function') { return; }
      c.auth.getSession().then(function (r) {
        var ses = r && r.data && r.data.session;
        var tok = ses && ses.access_token;
        if (!tok || tok === pgaTokenVisto) { return; }
        pgaTokenVisto = tok;
        try {
          if (c.realtime && typeof c.realtime.setAuth === 'function') { c.realtime.setAuth(tok); }
        } catch (e) {}
      })['catch'](function () {});
    }, PGA_MS_TOKEN);
  }

  /* Con el SDK y el DOM listos: ¿ya hay sesión? */
  function pgaIntentar(area) {
    if (window.__pgnovAutoArrancado) { return; }
    var c = pgaCliente();
    if (!c || !c.auth || typeof c.auth.getSession !== 'function') { pgaProgramarReintento(area); return; }
    c.auth.getSession().then(function (r) {
      var ses = r && r.data && r.data.session;
      if (!ses) { pgaProgramarReintento(area); return; }   // sigue en el login
      if (window.__pgnovAutoArrancado) { return; }
      window.__pgnovAutoArrancado = true;
      pgaDetenerReintento();
      pgaTokenVisto = ses.access_token || null;
      pgaVigilarToken();
      console.log('[pg-novedades] arranque automático con sesión propia (área '
        + (area || 'mis áreas') + ')');
      window.pgRevisarNovedades(c, area);                  // flujo normal
    })['catch'](function (e) {
      console.warn('[pg-novedades] no se pudo leer la sesión', e);
      pgaProgramarReintento(area);
    });
  }

  /* v4: se admite pgNovedadesAuto() y pgNovedadesAuto(null) — es como lo llama
     el portal (index.html). Sin área, el widget usa novedades_mis_areas(). */
  window.pgNovedadesAuto = function (area) {
    if (window.__pgnovAutoIniciado) { return; }   // idempotente: un arranque por página
    window.__pgnovAutoIniciado = true;
    var ar = area || null;

    var intentos = 0;
    function esperar() {
      /* 1) que haya cargado supabase-js del CDN (hasta ~10 s) */
      if (!pgaHaySDK()) {
        intentos++;
        if (intentos > PGA_MAX_SDK) {
          console.warn('[pg-novedades] supabase-js no cargó en 10 s; el widget no arranca en esta página');
          window.__pgnovAutoIniciado = false;   // permite reintentar a mano
          return;
        }
        setTimeout(esperar, PGA_MS_SDK);
        return;
      }
      /* 2) que exista el DOM (el overlay necesita document.body) */
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { pgaIntentar(ar); });
        return;
      }
      pgaIntentar(ar);
    }
    esperar();
  };

  console.log('[pg-novedades] v4.5 activo — tema configurable + lotes + reacciones');
})();

/* ============================================================================
 * TODO pendientes (v4.0)
 * ---------------------------------------------------------------------------
 * TODO: las reacciones del overlay reaccionan a la novedad de la PANTALLA. En
 *       modo_ronda='mosaico' una pantalla puede tener N filas del mismo lote y
 *       hoy la reacción se registra sobre la PRIMERA fila del lote. Si se
 *       quiere reacción por persona dentro del mosaico, hay que pintar una fila
 *       de reacciones por tarjeta (decisión de producto, no técnica).
 * TODO: los conteos de reacciones se leen con un select directo a
 *       portal.novedades_reacciones. Si la RLS de esa tabla termina siendo más
 *       estrecha de lo previsto (§2), el select devolverá vacío y las
 *       reacciones quedarán inertes (clase .off) — no rompe la pantalla, pero
 *       hay que verificarlo con sesión real antes de publicar.
 * TODO: novedades_config se lee con select * a la tabla. Si más adelante se le
 *       pone RLS de solo-admin, hay que cambiarlo por una RPC de lectura
 *       (novedades_config_publica) — el fallback ya deja claro + persona.
 * TODO: el reparto del contador usa como total el MAYOR segundos_lectura de la
 *       cola. Si se quiere que sea la SUMA, se cambia solo totalConfig.
 * TODO: la vista previa del panel (novedades-admin.html) replica este formato.
 *       Si se cambia un color o un tamaño aquí, hay que cambiarlo también allá.
 * TODO (heredado): verificar en Supabase que portal.novedades siga en la
 *       publicación de Realtime (Database > Replication > supabase_realtime).
 * TODO (heredado): pgNovedadesAuto depende del storageKey por defecto de la
 *       gaveta de supabase-js; si una página lo cambia, el arranque automático
 *       deja de ver la sesión y se queda reintentando cada 5 s (no rompe nada).
 * TODO (heredado): la detección de "formulario sucio" es genérica. Si alguna
 *       página tiene un campo raro que dispare falsos positivos, se excluye por
 *       id agregándolo a IDS_LOGIN o ampliando campoExcluido().
 * ==========================================================================*/
