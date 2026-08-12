/* ============================================================================
 * pg-novedades.js  ·  Widget lector de Novedades ProtectGo  ·  v3.0
 * ----------------------------------------------------------------------------
 * Archivo COMPARTIDO. Se carga en el <head> de cada página SIN defer/async:
 *
 *     <script src="https://protectgo.github.io/quick-quotes/pg-novedades.js"></script>
 *
 * Como se ejecuta antes de que exista <body>, este archivo NO toca el DOM en el
 * momento de la definición. Todo acceso al DOM ocurre dentro de funciones que
 * se llaman después (asegurarEstilos, abrirOverlay, etc.).
 *
 * Al definir window.pgRevisarNovedades ANTES que el bloque inline viejo de cada
 * página, ese bloque se anula solo por su propio guardián:
 *     (function(){ if(window.pgRevisarNovedades) return; ... })()
 *
 * QUÉ CONSERVA DEL v2 (idéntico):
 *   - Tiempo real (postgres_changes) + respaldo de 60 s + visibilitychange/online.
 *   - Bloqueo protegido: banner rojo si hay un formulario a medio llenar.
 *   - Registro de lectura por persona y novedad (marcar_novedad_leida).
 *   - Contador que SOLO avanza con la pestaña visible y con foco, cartel de
 *     pausa y botón deshabilitado hasta cumplir el tiempo.
 *   - Arranque automático pgNovedadesAuto(area) con cliente de SOLO lectura.
 *   - Firma pública:  pgRevisarNovedades(sbClient, area)   ·  NO cambia.
 *
 * QUÉ CAMBIA EN EL v3 — FORMATO "PANTALLAS COMPLETAS":
 *   1) Cada novedad ocupa TODA la pantalla, una por una, como diapositivas.
 *      Se acabó la tarjeta blanca con varias novedades apretadas y scroll.
 *   2) Traje visual por categoría (felicitación / aviso / novedad / recordatorio)
 *      sobre el mismo esqueleto: progreso arriba, contenido centrado, botón abajo.
 *   3) Progreso discreto arriba: puntos + "2 de 4".
 *   4) Orden: felicitaciones primero, luego avisos, luego novedades de
 *      herramienta, luego recordatorios.
 *   5) Decisión D2 — el tiempo de lectura configurado en el panel se REPARTE
 *      entre las pantallas pendientes (mínimo 15 s por pantalla), en vez de
 *      cobrarse completo en cada una.
 *   6) La lectura se registra AL CONFIRMAR CADA PANTALLA (antes se marcaban
 *      todas de una vez al final). Si alguien cierra el navegador a mitad de
 *      la cola, lo que ya leyó queda leído.
 * ==========================================================================*/

(function () {
  'use strict';

  /* Si el archivo se cargó dos veces, no volvemos a definir nada. */
  if (window.PG_NOVEDADES_VERSION) { return; }
  window.PG_NOVEDADES_VERSION = '3.0';

  /* --------------------------------------------------------------------- */
  /* Constantes                                                            */
  /* --------------------------------------------------------------------- */

  var MS_RESPALDO      = 60000;   // paracaídas: revisa cada 60 s por si el socket murió
  var MS_DEBOUNCE      = 800;     // anti-tormenta de eventos realtime
  var MS_BANNER_MAX    = 180000;  // 3 minutos: el banner se convierte en overlay sí o sí
  var MS_VENTANA_ENTRADA = 30000; // llamadas dentro de los primeros 30 s = "acaba de entrar"
  var MS_RESUSCRIBIR   = 8000;    // espera antes de reintentar la suscripción caída
  var MS_TRANSICION    = 260;     // salida de una pantalla antes de pintar la siguiente
  var SEG_MINIMO       = 15;      // D2: piso de lectura por pantalla
  var SEG_POR_DEFECTO  = 90;      // si la novedad no trae segundos_lectura

  var TIPOS = {
    felicitacion: { c: 'felicitacion', e: '🎉', n: 'Felicitación' },
    aviso:        { c: 'aviso',        e: '⚠️', n: 'Aviso importante' },
    recordatorio: { c: 'recordatorio', e: '📌', n: 'Recordatorio' },
    novedad:      { c: 'novedad',      e: '🔧', n: 'Novedad' }
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
  var areaActual     = null;   // 'general', 'kam', 'fam', 'coi', 'rrhh'...
  var tPrimeraLlamada= 0;      // marca de tiempo de la primera llamada
  var estadoOv       = null;   // { quitar:fn, cerrar:fn, ids:fn } mientras el overlay está abierto
  var timerRespaldo  = null;
  var timerDebounce  = null;
  var timerBanner    = null;
  var detectorPuesto = false;
  var respaldoPuesto = false;
  var resuscribiendo = false;

  /* --------------------------------------------------------------------- */
  /* 1. Estilos: se inyectan en el primer uso, nunca al definir el archivo  */
  /* --------------------------------------------------------------------- */

  function asegurarEstilos() {
    if (document.getElementById('pgnovStyleV3')) { return; }
    if (!document.head) {
      /* Todavía no hay <head> utilizable: esperamos al DOM. */
      document.addEventListener('DOMContentLoaded', asegurarEstilos);
      return;
    }
    var st = document.createElement('style');
    st.id = 'pgnovStyleV3';
    st.textContent =
      /* ---------- Lienzo: pantalla completa, sin tarjeta ---------- */
        '.pgnov-ov{position:fixed;inset:0;z-index:2147483000;background:#06202A;'
      + 'font-family:Inter,Arial,Helvetica,sans-serif;color:#E8F1F3;overflow:hidden;'
      + '-webkit-font-smoothing:antialiased;}'
      + '.pgnov-slide{position:relative;height:100%;width:100%;max-width:1180px;margin:0 auto;'
      + 'display:flex;flex-direction:column;padding:clamp(18px,3vh,34px) clamp(20px,4vw,56px);'
      + 'box-sizing:border-box;opacity:1;transform:translateY(0);'
      + 'transition:opacity .26s ease,transform .26s ease;}'
      + '.pgnov-slide.entrando{opacity:0;transform:translateY(14px);}'
      + '.pgnov-slide.saliendo{opacity:0;transform:translateY(-10px);}'

      /* ---------- Barra superior: kicker + progreso ---------- */
      + '.pgnov-top{display:flex;align-items:center;justify-content:space-between;gap:16px;'
      + 'flex:0 0 auto;padding-bottom:clamp(10px,2vh,20px);}'
      + '.pgnov-kicker{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;'
      + 'color:#A8D4CF;opacity:.85;white-space:nowrap;}'
      + '.pgnov-prog{display:flex;align-items:center;gap:12px;}'
      + '.pgnov-dots{display:inline-flex;align-items:center;gap:6px;}'
      + '.pgnov-dots i{display:block;width:10px;height:10px;border-radius:99px;'
      + 'background:rgba(255,255,255,.22);transition:width .26s ease,background .26s ease;}'
      + '.pgnov-dots i.done{background:rgba(255,255,255,.5);}'
      + '.pgnov-dots i.on{width:26px;background:#A8D4CF;}'
      + '.pgnov-count{font-size:11.5px;font-weight:700;letter-spacing:.08em;color:#9DBAC4;'
      + 'text-transform:uppercase;white-space:nowrap;}'

      /* ---------- Cuerpo centrado ---------- */
      + '.pgnov-body{flex:1;min-height:0;overflow-y:auto;display:flex;align-items:center;'
      + 'justify-content:center;text-align:center;padding:6px 0;}'
      + '.pgnov-body::-webkit-scrollbar{width:8px;}'
      + '.pgnov-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:99px;}'
      + '.pgnov-in{width:100%;max-width:980px;margin:auto;display:flex;flex-direction:column;'
      + 'align-items:center;gap:clamp(12px,2.2vh,22px);}'
      + '.pgnov-badge{display:inline-flex;align-items:center;gap:7px;font-size:11px;font-weight:800;'
      + 'letter-spacing:.14em;text-transform:uppercase;padding:7px 16px;border-radius:99px;'
      + 'border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);}'
      + '.pgnov-tit{margin:0;font-family:Montserrat,Inter,Arial,sans-serif;font-weight:800;'
      + 'line-height:1.06;letter-spacing:-.015em;color:#fff;}'
      + '.pgnov-cue{margin:0;line-height:1.55;color:#CFE2E6;white-space:pre-wrap;max-width:56ch;}'
      + '.pgnov-pie{font-size:13px;font-weight:600;color:#9DBAC4;letter-spacing:.02em;}'
      + '.pgnov-foto{border-radius:18px;overflow:hidden;background:rgba(255,255,255,.05);'
      + 'border:1px solid rgba(255,255,255,.12);max-width:100%;}'
      + '.pgnov-foto img{display:block;width:100%;max-height:34vh;object-fit:cover;}'

      /* ---------- 🎉 FELICITACIÓN — la estrella del formato ---------- */
      + '.pgnov-ov.t-felicitacion{background:radial-gradient(120% 90% at 50% 0%,#0E3B3A 0%,#06202A 62%);}'
      + '.t-felicitacion .pgnov-dots i.on{background:#00C864;}'
      + '.t-felicitacion .pgnov-badge{color:#7BF0B2;border-color:rgba(0,200,100,.42);'
      + 'background:rgba(0,200,100,.10);}'
      + '.t-felicitacion .pgnov-tit{font-size:clamp(34px,5.6vw,74px);}'
      + '.t-felicitacion .pgnov-in.sin-foto .pgnov-tit{font-size:clamp(42px,7.5vw,96px);}'
      + '.t-felicitacion .pgnov-cue{font-size:clamp(17px,2.1vw,27px);color:#DCEFE7;}'
      + '.t-felicitacion .pgnov-fel-foto{border-radius:22px;overflow:hidden;'
      + 'border:2px solid rgba(0,200,100,.34);box-shadow:0 24px 70px rgba(0,0,0,.5),0 0 0 10px rgba(0,200,100,.06);'
      + 'background:rgba(0,200,100,.08);max-width:min(660px,92%);}'
      + '.t-felicitacion .pgnov-fel-foto img{display:block;width:100%;height:min(46vh,430px);'
      + 'object-fit:cover;}'
      + '.t-felicitacion .pgnov-pie{color:#7BF0B2;}'
      /* Confeti sutil: 12 puntos, sin librerías y sin tapar el contenido. */
      + '.pgnov-confeti{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0;}'
      + '.pgnov-confeti i{position:absolute;top:-14px;width:8px;height:12px;border-radius:2px;'
      + 'opacity:.45;animation:pgnovCae linear infinite;}'
      + '@keyframes pgnovCae{0%{transform:translateY(-10vh) rotate(0deg);opacity:0;}'
      + '10%{opacity:.5;}100%{transform:translateY(112vh) rotate(420deg);opacity:0;}}'
      + '@media(prefers-reduced-motion:reduce){.pgnov-confeti{display:none;}'
      + '.pgnov-slide{transition:none;}}'
      + '.pgnov-slide>.pgnov-top,.pgnov-slide>.pgnov-body,.pgnov-slide>.pgnov-bot{position:relative;z-index:1;}'

      /* ---------- ⚠️ AVISO — serio y que pese ---------- */
      + '.pgnov-ov.t-aviso{background:linear-gradient(180deg,#0D3040 0%,#06202A 100%);}'
      /* Franja de ancho COMPLETO (va sobre el overlay, no sobre el slide, que
         está centrado a 1180px y dejaba la franja flotando en el medio). */
      + '.pgnov-ov.t-aviso::before{content:"";position:absolute;top:0;left:0;right:0;'
      + 'height:10px;background:#FFB400;z-index:2;}'
      + '.t-aviso .pgnov-dots i.on{background:#FFB400;}'
      + '.t-aviso .pgnov-marco{border:2px solid rgba(255,180,0,.55);border-radius:20px;'
      + 'background:rgba(255,180,0,.05);padding:clamp(20px,3.4vh,40px) clamp(20px,3.6vw,52px);'
      + 'display:flex;flex-direction:column;align-items:center;gap:clamp(12px,2vh,20px);width:100%;'
      + 'box-sizing:border-box;}'
      + '.t-aviso .pgnov-enc{font-size:clamp(12px,1.35vw,16px);font-weight:800;letter-spacing:.16em;'
      + 'text-transform:uppercase;color:#FFB400;}'
      + '.t-aviso .pgnov-tit{font-size:clamp(28px,4vw,52px);}'
      + '.t-aviso .pgnov-cue{font-size:clamp(17px,2vw,25px);color:#EAE0CB;}'
      + '.t-aviso .pgnov-pie{color:#E2C173;}'

      /* ---------- 🔧 NOVEDAD — profesional, con aire ---------- */
      + '.pgnov-ov.t-novedad{background:linear-gradient(180deg,#0D3040 0%,#06202A 100%);}'
      + '.t-novedad .pgnov-dots i.on{background:#229A82;}'
      + '.t-novedad .pgnov-badge{color:#A8D4CF;border-color:rgba(34,154,130,.5);'
      + 'background:rgba(34,154,130,.12);}'
      + '.t-novedad .pgnov-tit{font-size:clamp(28px,4vw,50px);}'
      + '.t-novedad .pgnov-cue{font-size:clamp(16px,1.9vw,23px);line-height:1.62;max-width:52ch;}'

      /* ---------- 📌 RECORDATORIO — el más sobrio ---------- */
      + '.pgnov-ov.t-recordatorio{background:linear-gradient(180deg,#0B2A36 0%,#06202A 100%);}'
      + '.t-recordatorio .pgnov-dots i.on{background:#8DA0AD;}'
      + '.t-recordatorio .pgnov-badge{color:#B7C7D0;border-color:rgba(141,160,173,.4);'
      + 'background:rgba(141,160,173,.10);}'
      + '.t-recordatorio .pgnov-tit{font-size:clamp(26px,3.4vw,44px);color:#E8F1F3;}'
      + '.t-recordatorio .pgnov-cue{font-size:clamp(16px,1.8vw,22px);color:#B7C7D0;}'

      /* ---------- Pie: pausa + barra + botón ---------- */
      + '.pgnov-bot{flex:0 0 auto;padding-top:clamp(12px,2.2vh,22px);display:flex;'
      + 'flex-direction:column;align-items:center;gap:10px;}'
      + '.pgnov-pausa{display:none;background:rgba(255,180,0,.12);border:1px solid rgba(255,180,0,.4);'
      + 'color:#FFCB57;border-radius:9px;padding:8px 14px;font-size:12.5px;font-weight:600;text-align:center;}'
      + '.pgnov-bar{width:min(420px,100%);height:6px;border-radius:99px;'
      + 'background:rgba(255,255,255,.14);overflow:hidden;}'
      + '.pgnov-bar i{display:block;height:100%;width:0;background:#A8D4CF;transition:width .95s linear;}'
      + '.t-felicitacion .pgnov-bar i{background:#00C864;}'
      + '.t-aviso .pgnov-bar i{background:#FFB400;}'
      + '.t-novedad .pgnov-bar i{background:#229A82;}'
      + '.t-recordatorio .pgnov-bar i{background:#8DA0AD;}'
      + '.pgnov-bot button{width:min(420px,100%);padding:16px;border:none;border-radius:12px;'
      + 'font-weight:800;font-size:15px;cursor:pointer;font-family:inherit;letter-spacing:.01em;'
      + 'background:#229A82;color:#fff;transition:filter .2s,background .2s;}'
      + '.t-felicitacion .pgnov-bot button{background:#00C864;color:#06202A;}'
      + '.t-aviso .pgnov-bot button{background:#FFB400;color:#06202A;}'
      + '.t-novedad .pgnov-bot button{background:#229A82;color:#fff;}'
      + '.t-recordatorio .pgnov-bot button{background:#8DA0AD;color:#06202A;}'
      + '.pgnov-bot button:hover:not(:disabled){filter:brightness(1.08);}'
      /* Deshabilitado: tiene que leerse INERTE sobre cualquiera de los cuatro
         fondos. Un blanco translúcido se veía verde encima de la felicitación
         y parecía que el botón ya estaba habilitado. */
      + '.pgnov-ov .pgnov-bot button:disabled{background:#0A2A34;color:#8DA0AD;'
      + 'box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);cursor:not-allowed;filter:none;}'
      + '.pgnov-note{font-size:11.5px;color:#8DA0AD;text-align:center;line-height:1.5;'
      + 'white-space:pre-line;min-height:16px;}'

      /* ---------- Celular: vertical, foto arriba, texto abajo ---------- */
      + '@media(max-width:640px){'
      + '.pgnov-slide{padding:16px 18px 18px;}'
      + '.pgnov-body{align-items:flex-start;}'
      + '.pgnov-in{gap:14px;}'
      + '.pgnov-kicker{font-size:10px;}'
      + '.t-felicitacion .pgnov-tit{font-size:clamp(28px,8vw,44px);}'
      + '.t-felicitacion .pgnov-in.sin-foto .pgnov-tit{font-size:clamp(32px,10vw,52px);}'
      + '.t-felicitacion .pgnov-fel-foto{max-width:100%;}'
      + '.t-felicitacion .pgnov-fel-foto img{height:34vh;}'
      + '.t-felicitacion .pgnov-cue{font-size:16.5px;}'
      + '.t-aviso .pgnov-tit,.t-novedad .pgnov-tit{font-size:clamp(24px,7vw,34px);}'
      + '.t-recordatorio .pgnov-tit{font-size:clamp(22px,6.4vw,32px);}'
      + '.t-aviso .pgnov-cue,.t-novedad .pgnov-cue,.t-recordatorio .pgnov-cue{font-size:16px;}'
      + '.t-aviso .pgnov-marco{padding:18px 16px;}'
      + '.pgnov-foto img{max-height:26vh;}'
      + '.pgnov-bot button,.pgnov-bar{width:100%;}'
      + '}'

      /* ---------- Banner rojo del bloqueo protegido (igual que el v2) ---------- */
      + '.pgnov-banner{position:fixed;top:0;left:0;right:0;z-index:2147482000;background:#C0392B;'
      + 'color:#fff;font-family:Inter,Arial,Helvetica,sans-serif;font-size:13.5px;font-weight:600;'
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

  /* Orden de aparición: felicitaciones → avisos → novedades → recordatorios.
     Dentro de cada grupo se respeta el orden en que vino la RPC (sort estable
     emulado con el índice original, porque Array.prototype.sort no garantiza
     estabilidad en navegadores viejos). */
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
       contenteditable, no INPUT/SELECT/TEXTAREA: si no los contamos aquí,
       alguien escribiendo un acta no ve el banner rojo y el overlay le tapa
       la pantalla de golpe. */
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
    /* Los <div> de texto enriquecido no tienen .value: se leen por texto. */
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
  /* 4. Banner rojo (bloqueo protegido · decisión D2 del montaje anterior)  */
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
    b.innerHTML = '<span class="msg">📢 Tienes una novedad pendiente — se abrirá cuando termines lo que estás haciendo</span>'
                + '<button type="button" id="pgnovBannerBtn">Verla ahora</button>';
    document.body.appendChild(b);

    var btn = document.getElementById('pgnovBannerBtn');
    if (btn) {
      btn.addEventListener('click', function () { forzarApertura('boton-banner'); });
    }

    /* A los 3 minutos entra el overlay pase lo que pase. */
    timerBanner = setTimeout(function () { forzarApertura('timeout-3min'); }, MS_BANNER_MAX);
    console.log('[pg-novedades] banner de novedad pendiente (hay trabajo a medias)');
  }

  /* Abre el overlay ya: quita el banner y vuelve a preguntarle a la RPC.
     'retrasoMs' le da un respiro al guardado de la página para que arranque
     antes de que el overlay le tape la pantalla. */
  function forzarApertura(motivo, retrasoMs) {
    quitarBanner();
    if (hayOverlay()) { return; }
    console.log('[pg-novedades] abriendo overlay por: ' + motivo);
    setTimeout(function () {
      if (hayOverlay()) { return; }
      pedirPendientes(function (items) {
        if (!items.length) { return; }
        abrirOverlay(items, 'vivo');
      });
    }, retrasoMs || 0);
  }

  /* --------------------------------------------------------------------- */
  /* 5. Consulta a la RPC — la RPC es la ÚNICA que decide qué se muestra    */
  /* --------------------------------------------------------------------- */

  function pedirPendientes(cb, intento) {
    if (!cliente || !areaActual) { cb([]); return; }
    /* Si ya hay una consulta en vuelo, esperamos y reintentamos (hasta 5 veces)
       en vez de devolver vacío: si no, el botón "Verla ahora" podría no hacer nada. */
    if (window.__pgnovCorriendo) {
      intento = intento || 0;
      if (intento >= 5) { cb([]); return; }
      setTimeout(function () { pedirPendientes(cb, intento + 1); }, 400);
      return;
    }
    window.__pgnovCorriendo = true;
    cliente.rpc('novedades_pendientes', { p_area: areaActual }).then(function (r) {
      window.__pgnovCorriendo = false;
      if (r && r.error) { console.warn('[pg-novedades] error en novedades_pendientes', r.error); }
      cb((r && !r.error && r.data) ? r.data.slice() : []);
    })['catch'](function (e) {
      window.__pgnovCorriendo = false;
      console.warn('[pg-novedades] fallo consultando pendientes', e);
      cb([]);
    });
  }

  /* Revisión general.
   * modo 'entrada' = la persona acaba de entrar  -> overlay inmediato (igual que hoy).
   * modo 'vivo'    = la novedad llegó estando adentro -> aplica bloqueo protegido. */
  function revisar(modo) {
    if (!cliente || !areaActual) { return; }
    if (hayOverlay()) { return; }
    if (modo === 'vivo' && hayBanner()) { return; } // ya avisamos, no repetimos
    if (!document.body) { return; }                 // aún no hay dónde pintar

    pedirPendientes(function (items) {
      if (!items.length) { return; }
      if (hayOverlay()) { return; }
      if (modo === 'vivo' && window.pgFormSucio) {
        mostrarBanner();          // trabajo a medias -> primero avisamos
      } else {
        abrirOverlay(items, modo);
      }
    });
  }

  /* --------------------------------------------------------------------- */
  /* 6. Overlay lector v3 — una novedad = una pantalla completa            */
  /* --------------------------------------------------------------------- */

  function abrirOverlay(listaCruda, modo) {
    if (!listaCruda || !listaCruda.length || hayOverlay() || !document.body) { return; }
    asegurarEstilos();
    quitarBanner();

    var items   = ordenar(listaCruda.slice());
    var actual  = 0;      // índice de la pantalla que se está mostrando
    var leidas  = {};     // ids ya confirmados en esta cola (no se re-muestran)
    var tick    = null;   // intervalo del contador de la pantalla actual
    var restante= 0;      // segundos que le faltan a ESTA pantalla
    var segsPant= 0;      // segundos totales de ESTA pantalla
    var confirmando = false;

    /* El bloqueo (fondo congelado + contador) aplica si alguna es bloqueante. */
    var bloquea = items.some(function (n) { return n.bloqueante !== false; });

    /* D2 — el tiempo configurado en el panel se REPARTE entre las pantallas.
       totalConfig = el mayor segundos_lectura de las bloqueantes (así una
       novedad marcada con más tiempo sigue mandando sobre el total). */
    var totalConfig = 0;
    items.forEach(function (n) {
      var s = parseInt(n.segundos_lectura, 10);
      if (n.bloqueante !== false && s > totalConfig) { totalConfig = s; }
    });
    if (bloquea && !totalConfig) { totalConfig = SEG_POR_DEFECTO; }

    /* Cuántas pantallas se van a cobrar tiempo. */
    var nBloqueantes = 0;
    items.forEach(function (n) { if (n.bloqueante !== false) { nBloqueantes++; } });

    /* D2 — el reparto se calcula UNA sola vez, al abrir la cola, y no se mueve.
       Así el tiempo por pantalla es el mismo en las cuatro y es explicable de
       una frase: "1:30 repartido entre 4 pantallas = 23 segundos cada una".
       Si a mitad de la cola bajan una novedad, las que quedan conservan sus
       23 s (el bloqueo total baja, nunca sube). */
    var SEG_PANTALLA = 0;
    if (bloquea) {
      SEG_PANTALLA = Math.max(SEG_MINIMO, Math.round(totalConfig / (nBloqueantes || 1)));
    }

    function segundosDe(i) {
      var n = items[i];
      if (!n || n.bloqueante === false || !bloquea) { return 0; }
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

    /* ---------------- Esqueleto (se pinta una sola vez) ---------------- */

    var ov = document.createElement('div');
    ov.id = 'pgnovOv';
    ov.className = 'pgnov-ov';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.innerHTML =
        '<div class="pgnov-confeti" id="pgnovConfeti"></div>'
      + '<div class="pgnov-slide" id="pgnovSlide">'
      +   '<header class="pgnov-top">'
      +     '<div class="pgnov-kicker">📢 ProtectGo · al día</div>'
      +     '<div class="pgnov-prog"><span class="pgnov-dots" id="pgnovDots"></span>'
      +     '<span class="pgnov-count" id="pgnovCount"></span></div>'
      +   '</header>'
      +   '<main class="pgnov-body" id="pgnovBody"></main>'
      +   '<footer class="pgnov-bot">'
      +     '<div class="pgnov-pausa" id="pgnovPausa">⏸️ Contador detenido — vuelve a esta ventana para que siga corriendo</div>'
      +     '<div class="pgnov-bar" id="pgnovBar"><i id="pgnovFill"></i></div>'
      +     '<button id="pgnovBtn" type="button">Ya lo leí, entendido</button>'
      +     '<div class="pgnov-note" id="pgnovC"></div>'
      +   '</footer>'
      + '</div>';
    document.body.appendChild(ov);

    var slide  = ov.querySelector('#pgnovSlide'),
        cuerpo = ov.querySelector('#pgnovBody'),
        dots   = ov.querySelector('#pgnovDots'),
        cuenta = ov.querySelector('#pgnovCount'),
        btn    = ov.querySelector('#pgnovBtn'),
        fill   = ov.querySelector('#pgnovFill'),
        barra  = ov.querySelector('#pgnovBar'),
        nota   = ov.querySelector('#pgnovC'),
        pausa  = ov.querySelector('#pgnovPausa'),
        confeti= ov.querySelector('#pgnovConfeti');

    fondo(bloquea);
    document.addEventListener('keydown', tragaEscape, true);

    /* ---------------- Pintado de UNA pantalla ---------------- */

    /* Crea un nodo con texto seguro (nunca innerHTML con datos). */
    function nodo(tag, clase, texto) {
      var e = document.createElement(tag);
      if (clase) { e.className = clase; }
      if (texto !== undefined && texto !== null) { e.textContent = texto; }
      return e;
    }

    function bloqueFoto(n, claseCaja) {
      if (!n.imagen_url) { return null; }
      var caja = document.createElement('div');
      caja.className = claseCaja;
      var img = document.createElement('img');
      img.alt = n.pie_foto || n.titulo || '';
      img.loading = 'lazy';
      img.onerror = function () {
        /* Foto rota: se retira la caja y, en felicitación, el nombre crece. */
        if (caja.parentNode) { caja.parentNode.removeChild(caja); }
        var cont = ov.querySelector('.pgnov-in');
        if (cont && tipoDe(items[actual]) === 'felicitacion') { cont.classList.add('sin-foto'); }
      };
      img.src = n.imagen_url;
      caja.appendChild(img);
      return caja;
    }

    function armarConfeti(encender) {
      confeti.innerHTML = '';
      if (!encender) { return; }
      var colores = ['#00C864', '#A8D4CF', '#FFB400', '#7BF0B2'];
      var i, p;
      for (i = 0; i < 12; i++) {
        p = document.createElement('i');
        p.style.left = Math.round((i * 8.3) + (i % 3) * 2.5) + '%';
        p.style.background = colores[i % colores.length];
        p.style.animationDuration = (7 + (i % 5) * 1.6) + 's';
        p.style.animationDelay = ((i % 6) * 1.1) + 's';
        confeti.appendChild(p);
      }
    }

    function pintarProgreso() {
      dots.innerHTML = '';
      var i, d;
      for (i = 0; i < items.length; i++) {
        d = document.createElement('i');
        if (i < actual) { d.className = 'done'; }
        else if (i === actual) { d.className = 'on'; }
        dots.appendChild(d);
      }
      cuenta.textContent = (actual + 1) + ' de ' + items.length;
      /* Con una sola novedad los puntos sobran: se deja solo el conteo. */
      dots.style.display = items.length > 1 ? '' : 'none';
      cuenta.style.display = items.length > 1 ? '' : 'none';
    }

    function pintarCuerpo() {
      var n = items[actual], t = tipoDe(n), meta = TIPOS[t];
      ov.className = 'pgnov-ov t-' + t;
      armarConfeti(t === 'felicitacion');

      var caja = nodo('div', 'pgnov-in');
      cuerpo.innerHTML = '';

      if (t === 'felicitacion') {
        var foto = bloqueFoto(n, 'pgnov-fel-foto');
        if (!foto) { caja.classList.add('sin-foto'); }
        caja.appendChild(nodo('div', 'pgnov-badge', meta.e + ' ' + meta.n));
        if (foto) { caja.appendChild(foto); }
        caja.appendChild(nodo('h2', 'pgnov-tit', n.titulo || ''));
        if (n.cuerpo) { caja.appendChild(nodo('p', 'pgnov-cue', n.cuerpo)); }
        if (n.pie_foto) { caja.appendChild(nodo('div', 'pgnov-pie', n.pie_foto)); }
        cuerpo.appendChild(caja);

      } else if (t === 'aviso') {
        var marco = nodo('div', 'pgnov-marco');
        marco.appendChild(nodo('div', 'pgnov-enc', 'AVISO IMPORTANTE'));
        marco.appendChild(nodo('h2', 'pgnov-tit', n.titulo || ''));
        var fa = bloqueFoto(n, 'pgnov-foto');
        if (fa) { marco.appendChild(fa); }
        if (n.cuerpo) { marco.appendChild(nodo('p', 'pgnov-cue', n.cuerpo)); }
        if (n.pie_foto) { marco.appendChild(nodo('div', 'pgnov-pie', n.pie_foto)); }
        caja.appendChild(marco);
        cuerpo.appendChild(caja);

      } else {
        caja.appendChild(nodo('div', 'pgnov-badge', meta.e + ' ' + meta.n));
        caja.appendChild(nodo('h2', 'pgnov-tit', n.titulo || ''));
        var fo = bloqueFoto(n, 'pgnov-foto');
        if (fo) { caja.appendChild(fo); }
        if (n.cuerpo) { caja.appendChild(nodo('p', 'pgnov-cue', n.cuerpo)); }
        if (n.pie_foto) { caja.appendChild(nodo('div', 'pgnov-pie', n.pie_foto)); }
        cuerpo.appendChild(caja);
      }

      cuerpo.scrollTop = 0;
    }

    function textoBotonListo() {
      return (actual < items.length - 1) ? 'Ya lo leí, siguiente →' : 'Ya lo leí, entendido';
    }

    function textoNota() {
      var faltan = items.length - actual - 1;
      if (faltan <= 0) { return ''; }
      return faltan === 1 ? 'Después de esta te queda 1 más.'
                          : 'Después de esta te quedan ' + faltan + ' más.';
    }

    function leyendo() {
      try { return document.visibilityState === 'visible' && document.hasFocus(); }
      catch (e) { return document.visibilityState === 'visible'; }
    }

    function pintaContador() {
      if (!segsPant) { return; }
      var m = Math.floor(restante / 60), s = restante % 60;
      btn.textContent = 'Podrás continuar en ' + m + ':' + (s < 10 ? '0' : '') + s;
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
      btn.textContent = textoBotonListo();
      nota.textContent = textoNota();
    }

    function arrancarContador() {
      if (tick) { clearInterval(tick); tick = null; }
      segsPant = segundosDe(actual);
      if (!segsPant) {                       // novedad informativa: sin contador
        barra.style.display = 'none';
        pausa.style.display = 'none';
        btn.disabled = false;
        btn.textContent = textoBotonListo();
        nota.textContent = textoNota();
        return;
      }
      barra.style.display = '';
      restante = segsPant;
      btn.disabled = true;
      pintaContador();
      tick = setInterval(function () {
        if (!leyendo()) { pintaContador(); return; }   // pestaña quieta: no corre
        restante--;
        if (restante <= 0) { liberarBoton(); return; }
        pintaContador();
      }, 1000);
    }

    /* Pinta la pantalla 'actual' completa (progreso + cuerpo + contador). */
    function pintarPantalla(conTransicion) {
      function hacer() {
        pintarProgreso();
        pintarCuerpo();
        arrancarContador();
        slide.classList.remove('saliendo');
        slide.classList.add('entrando');
        /* rAF doble: garantiza que el navegador aplique el estado inicial
           antes de quitar la clase, para que la transición se vea. */
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
      /* Igual que el v2: NUNCA se navega al cerrar (eso sacaba a la gente de
         donde estaba trabajando en coi/fam/kam/rrhh). */
    }

    /* La desactivaron mientras la cola estaba abierta (lo detecta el respaldo
       de 60 s: el RLS impide que ese UPDATE llegue por realtime).
       Una novedad YA LEÍDA no se quita: se queda como punto apagado del
       progreso, porque si no la barra "1 de 4" se encogería sola. */
    function quitarNovedad(id) {
      var idx = -1, i;
      if (leidas[String(id)]) { return; }
      for (i = 0; i < items.length; i++) { if (String(items[i].id) === String(id)) { idx = i; break; } }
      if (idx < 0) { return; }

      items.splice(idx, 1);
      if (!items.length) { cerrarTodo(); return; }

      if (idx < actual) {
        /* Se cayó una que ya había pasado: solo corre el índice. */
        actual--;
        pintarProgreso();
      } else if (idx === actual) {
        /* Se cayó la que está en pantalla: entra la siguiente sin marcarla leída.
           Si era la última de la cola, se cierra todo. */
        if (actual >= items.length) { cerrarTodo(); return; }
        pintarPantalla(true);
      } else {
        /* Se cayó una que venía más adelante: solo cambia el conteo. */
        pintarProgreso();
        if (!btn.disabled) {
          btn.textContent = textoBotonListo();
          nota.textContent = textoNota();
        }
      }
    }

    estadoOv = {
      quitar: quitarNovedad,
      cerrar: cerrarTodo,
      /* Solo los ids que la persona AÚN no ha confirmado. Los ya leídos
         desaparecen de novedades_pendientes por diseño; si los reportáramos
         aquí, el respaldo de 60 s creería que las bajaron y las sacaría de
         la barra de progreso. */
      ids: function () {
        return items.filter(function (n) { return !leidas[String(n.id)]; })
                    .map(function (n) { return String(n.id); });
      }
    };

    /* ---------------- Confirmar y avanzar ---------------- */

    btn.addEventListener('click', function () {
      if (btn.disabled || confirmando) { return; }
      var n = items[actual];
      if (!n) { return; }

      confirmando = true;
      btn.disabled = true;
      btn.textContent = 'Guardando…';

      cliente.rpc('marcar_novedad_leida', { p_novedad_id: n.id }).then(function (r) {
        confirmando = false;
        if (r && r.error) { falloAlGuardar(); return; }
        avanzar(n.id);
      })['catch'](function () {
        confirmando = false;
        falloAlGuardar();
      });
    });

    function falloAlGuardar() {
      btn.disabled = false;
      btn.textContent = 'Reintentar';
      nota.textContent = 'No se pudo registrar la lectura. Revisa tu conexión e inténtalo otra vez.';
    }

    /* Deja marcada la que se acaba de leer y pasa a la siguiente pantalla.
       La cola NO se encoge: así el indicador va 1 de 4 → 2 de 4 → 3 de 4 → 4 de 4,
       que es como se lee una diapositiva, y los puntos de atrás quedan apagados. */
    function avanzar(idLeida) {
      leidas[String(idLeida)] = true;
      actual++;
      if (actual >= items.length) { cerrarTodo(); return; }
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
    console.log('[pg-novedades] cola abierta en pantallas completas ('
      + items.length + ' pendiente(s), modo ' + modo + ')');
  }

  /* --------------------------------------------------------------------- */
  /* 7. Tiempo real (postgres_changes)                                     */
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
      /* OJO — esta rama casi nunca se va a disparar en producción, y es
         esperado: la tabla public.novedades tiene RLS de lectura
         (novedades_select_authenticated: SELECT WHERE activo = true) y
         Supabase Realtime respeta ese RLS. Cuando el admin baja una novedad
         (UPDATE activo=false), la fila deja de cumplir el WHERE para el
         usuario y Postgres/Realtime simplemente NO le entrega ese evento
         UPDATE (no es un bug de este archivo, y el RLS no se toca porque
         está correcto tal cual). Quien de verdad cierra en caliente la
         novedad bajada es el respaldo de 60 s: revisarOverlayAbierto() (más
         abajo, sección 8) vuelve a preguntarle a novedades_pendientes(area)
         mientras la cola sigue abierta y retira cualquier id que ya no
         venga en la respuesta. Dejamos esta rama igual por si algún día SÍ
         llega el evento (p.ej. con otra política o desde una conexión con
         más privilegios); el RUTEO POR ÁREA lo sigue decidiendo la RPC. */
      if (fila && tipoEv === 'UPDATE' && fila.activo === false && estadoOv) {
        estadoOv.quitar(fila.id);
      }
    } catch (e) { /* nunca dejamos que un payload raro tumbe el widget */ }
    /* Cualquier evento solo DISPARA la revisión; qué se muestra lo dice la RPC. */
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
      canal = cliente.channel('pgnov-' + areaActual + '-' + Math.random().toString(36).slice(2, 8))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'novedades' }, alRecibirEvento)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'novedades' }, alRecibirEvento)
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
  /* 8. Respaldo: timer de 60 s + volver a la pestaña + volver a internet   */
  /* --------------------------------------------------------------------- */

  /* Con la cola YA abierta, este es el que de verdad cierra en caliente una
     novedad que el admin bajó (activo=false) o que venció. Por qué hace falta:
     el RLS de lectura de public.novedades exige activo = true, y Realtime
     respeta ese RLS, así que el evento UPDATE de "la bajaron" nunca le llega
     al usuario (ver el comentario grande en alRecibirEvento). Por eso, en vez
     de esperar un evento que no va a llegar, cada 60 s le volvemos a preguntar
     a novedades_pendientes(area) y comparamos contra los ids que la cola sigue
     mostrando:
       - id que ya no viene en la respuesta -> se quita (quitarNovedad, que
         además reacomoda el reparto del contador y la barra de progreso).
       - si con eso la cola queda vacía -> se cierra sola.
     Esta función NUNCA abre una cola nueva (esa ruta es 'revisar') ni
     interfiere con el banner rojo del formulario sucio. */
  function revisarOverlayAbierto() {
    if (!estadoOv) { return; }
    pedirPendientes(function (vivos) {
      if (!estadoOv) { return; } // se cerró mientras esperábamos la respuesta de la RPC
      var idsVivos = {}, i;
      for (i = 0; i < vivos.length; i++) { idsVivos[String(vivos[i].id)] = true; }
      var idsCola = estadoOv.ids();
      for (i = 0; i < idsCola.length; i++) {
        if (!estadoOv) { break; } // la cola se vació a mitad de la vuelta -> ya se cerró todo
        if (!idsVivos[idsCola[i]]) { estadoOv.quitar(idsCola[i]); }
      }
    });
  }

  function arrancarRespaldo() {
    if (respaldoPuesto) { return; }
    respaldoPuesto = true;

    /* El paracaídas: aunque el socket se haya caído, esto revisa igual.
       Si la cola ya está abierta, 'revisar' no hace nada (ver su propio
       guardián hayOverlay()), así que ahí entra revisarOverlayAbierto(). */
    timerRespaldo = setInterval(function () {
      if (hayOverlay()) { revisarOverlayAbierto(); } else { revisar('vivo'); }
    }, MS_RESPALDO);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        revisarConDebounce();
        /* Al volver, si el canal murió lo levantamos. */
        if (!window.__pgnovCanal) { arrancarTiempoReal(); }
      }
    });

    window.addEventListener('online', function () {
      revisarConDebounce();
      if (!window.__pgnovCanal) { arrancarTiempoReal(); }
    });
  }

  /* --------------------------------------------------------------------- */
  /* 9. API pública — MISMA FIRMA que el v1 y el v2                        */
  /* --------------------------------------------------------------------- */

  window.pgRevisarNovedades = function (sbClient, area) {
    if (!sbClient || !area) { return; }

    cliente = sbClient;
    areaActual = area;
    asegurarEstilos();
    instalarDetectorFormularios();

    var ahora = (new Date()).getTime();
    if (!tPrimeraLlamada) { tPrimeraLlamada = ahora; }

    /* Las páginas llaman esto varias veces (tarjetas.html lo llama 3 veces al
       cargar y otra vez cada 5 minutos). Las llamadas de los primeros 30 s
       cuentan como "acaba de entrar" -> overlay inmediato, igual que hoy.
       Las posteriores cuentan como "ya está adentro" -> bloqueo protegido. */
    var modo = (ahora - tPrimeraLlamada) < MS_VENTANA_ENTRADA ? 'entrada' : 'vivo';

    arrancarTiempoReal();
    arrancarRespaldo();
    revisar(modo);
  };

  /* Gancho de prueba: fuerza una revisión "como si la novedad llegara ahora"
     (aplica el bloqueo protegido). Sirve para probar el banner sin tener que
     insertar una fila desde el panel de novedades. */
  window.__pgnovProbarEnVivo = function () { revisar('vivo'); };

  /* Gancho de prueba: simula que el admin bajó una novedad con la cola abierta
     (la ruta real la dispara el respaldo de 60 s). */
  window.__pgnovBajar = function (id) { if (estadoOv) { estadoOv.quitar(id); } };

  /* Gancho de prueba: corre YA la pasada del respaldo de 60 s (vuelve a
     preguntarle a la RPC y retira de la cola lo que ya no venga). Es la ruta
     REAL con la que se cierra en caliente una novedad que el admin bajó; el
     gancho solo evita esperar el minuto en las pruebas. */
  window.__pgnovRevisarCola = function () { revisarOverlayAbierto(); };

  /* Ganchos de auditoría en vivo (consola del navegador). */
  window.__pgnovDiag = function () {
    return {
      version: window.PG_NOVEDADES_VERSION,
      area: areaActual,
      canal: !!window.__pgnovCanal,
      estadoCanal: window.__pgnovCanal && window.__pgnovCanal.state,
      formSucio: !!window.pgFormSucio,
      overlay: hayOverlay(),
      banner: hayBanner(),
      cola: estadoOv ? estadoOv.ids() : []
    };
  };

  /* --------------------------------------------------------------------- */
  /* 10. Arranque automático (Módulo B) — window.pgNovedadesAuto(area)      */
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
     Quien manda sobre la sesión sigue siendo el login de la página. */

  var PGA_URL = 'https://bwqzypuiqgxzsrtsueab.supabase.co';
  var PGA_KEY = 'sb_publishable_VbA94M3mF-Z6kgtPnda-cQ_diKF8L49';
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
    var opciones = { auth: {
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

  /* Vigilancia del token (caso "se venció el JWT mientras estaba abierta la
     página"). Cómo queda resuelto:
       - Las RPC: supabase-js con persistSession:true relee la gaveta en cada
         getSession(), y cada llamada REST pide el token con getSession(). Como
         el login de la página SÍ refresca y guarda el token nuevo en la misma
         gaveta, la siguiente RPC del respaldo de 60 s ya sale con el token
         fresco. Es decir, el 401 se cura solo en el siguiente ciclo.
       - El realtime: el socket guarda el token con el que se conectó, así que
         ahí sí hay que avisarle. Este vigía compara el access_token cada 60 s
         y, si cambió, llama realtime.setAuth(nuevo) — método público que NO
         escribe en la gaveta. */
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
      if (!ses) { pgaProgramarReintento(area); return; }   // sigue en el login: seguimos esperando
      if (window.__pgnovAutoArrancado) { return; }
      window.__pgnovAutoArrancado = true;
      pgaDetenerReintento();
      pgaTokenVisto = ses.access_token || null;
      pgaVigilarToken();
      console.log('[pg-novedades] arranque automático con sesión propia (área ' + area + ')');
      window.pgRevisarNovedades(c, area);                  // de aquí en adelante, flujo normal
    })['catch'](function (e) {
      console.warn('[pg-novedades] no se pudo leer la sesión', e);
      pgaProgramarReintento(area);
    });
  }

  window.pgNovedadesAuto = function (area) {
    if (!area) { return; }
    if (window.__pgnovAutoIniciado) { return; }   // idempotente: un solo arranque por página
    window.__pgnovAutoIniciado = true;

    var intentos = 0;
    function esperar() {
      /* 1) que haya cargado supabase-js del CDN (hasta ~10 s) */
      if (!pgaHaySDK()) {
        intentos++;
        if (intentos > PGA_MAX_SDK) {
          console.warn('[pg-novedades] supabase-js no cargó en 10 s; el widget no arranca en esta página');
          window.__pgnovAutoIniciado = false;   // permite reintentar a mano si hace falta
          return;
        }
        setTimeout(esperar, PGA_MS_SDK);
        return;
      }
      /* 2) que exista el DOM (el overlay necesita document.body) */
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { pgaIntentar(area); });
        return;
      }
      pgaIntentar(area);
    }
    esperar();
  };

  console.log('[pg-novedades] v3.0 activo — pantallas completas + realtime');
})();

/* ============================================================================
 * TODO pendientes (v3)
 * ---------------------------------------------------------------------------
 * TODO: el reparto del contador (D2) usa como total el MAYOR segundos_lectura
 *       de las novedades bloqueantes de la cola. Si algún día se quiere que el
 *       total sea la SUMA, se cambia solo el cálculo de totalConfig.
 * TODO: el registro de lectura ahora se hace pantalla por pantalla. La RPC
 *       marcar_novedad_leida ya era idempotente por persona+novedad; si alguna
 *       vez se cambia a "una sola llamada por sesión", hay que revisar esto.
 * TODO: la vista previa del panel (novedades-admin.html) replica este formato
 *       con clases pv-* propias. Si se cambia un color o un tamaño aquí, hay
 *       que cambiarlo también allá (fuente común: SPEC-pantallas.md).
 * TODO (heredado): verificar en Supabase que public.novedades siga en la
 *       publicación de Realtime (Database > Replication > supabase_realtime).
 * TODO (heredado): pgNovedadesAuto depende del storageKey por defecto de la
 *       gaveta; si una página lo cambia, el arranque automático deja de ver la
 *       sesión y se queda reintentando cada 5 s (no rompe la página).
 * TODO (heredado): la detección de "formulario sucio" es genérica. Si alguna
 *       página tiene un campo raro que dispare falsos positivos, se excluye por
 *       id agregándolo a IDS_LOGIN o ampliando campoExcluido().
 * ==========================================================================*/
