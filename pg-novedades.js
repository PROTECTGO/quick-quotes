/* ============================================================================
 * pg-novedades.js  ·  Widget lector de Novedades ProtectGo  ·  v2.0
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
 * QUÉ CONSERVA DEL v1 (idéntico, copiado literal):
 *   - Overlay bloqueante, tarjeta héroe para felicitaciones, tipos
 *     felicitacion / aviso / recordatorio / novedad, indicador de scroll.
 *   - Barra de progreso ámbar, contador que SOLO avanza con pestaña visible y
 *     con foco, cartel de pausa, botón deshabilitado hasta cumplir el tiempo.
 *   - marcar_novedad_leida para todas las novedades de una sola vez.
 *
 * QUÉ AGREGA EL v2:
 *   1) Tiempo real (postgres_changes sobre public.novedades) + respaldo por
 *      timer de 60s, visibilitychange y online.
 *   2) Bloqueo protegido (decisión D2): si la novedad cae con la persona
 *      trabajando y hay un formulario a medio llenar, primero banner rojo y el
 *      overlay entra al guardar/enviar o a los 3 minutos.
 *
 * Firma pública (NO cambia):  pgRevisarNovedades(sbClient, area)
 * ==========================================================================*/

(function () {
  'use strict';

  /* Si el archivo se cargó dos veces, no volvemos a definir nada. */
  if (window.PG_NOVEDADES_VERSION) { return; }
  window.PG_NOVEDADES_VERSION = '2.0';

  /* --------------------------------------------------------------------- */
  /* Constantes                                                            */
  /* --------------------------------------------------------------------- */

  var MS_RESPALDO      = 60000;   // paracaídas: revisa cada 60 s por si el socket murió
  var MS_DEBOUNCE      = 800;     // anti-tormenta de eventos realtime
  var MS_BANNER_MAX    = 180000;  // 3 minutos: el banner se convierte en overlay sí o sí
  var MS_VENTANA_ENTRADA = 30000; // llamadas dentro de los primeros 30 s = "acaba de entrar"
  var MS_RESUSCRIBIR   = 8000;    // espera antes de reintentar la suscripción caída

  var TIPOS = {
    felicitacion: { c: 'felicitacion', e: '🎉', n: 'Felicitación' },
    aviso:        { c: 'aviso',        e: '⚠️', n: 'Aviso importante' },
    recordatorio: { c: 'recordatorio', e: '📌', n: 'Recordatorio' },
    novedad:      { c: 'novedad',      e: '🔧', n: 'Novedad' }
  };

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
  var estadoOv       = null;   // { quitar:fn, cerrar:fn } mientras el overlay está abierto
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
    if (document.getElementById('pgnovStyleV2')) { return; }
    if (!document.head) {
      /* Todavía no hay <head> utilizable: esperamos al DOM. */
      document.addEventListener('DOMContentLoaded', asegurarEstilos);
      return;
    }
    var st = document.createElement('style');
    st.id = 'pgnovStyleV2';
    st.textContent =
      /* ---- CSS del v1, copiado tal cual (así se ve hoy y así debe verse) ---- */
      '.pgnov-ov{position:fixed;inset:0;z-index:2147483000;background:rgba(6,32,42,.94);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Inter,Arial,Helvetica,sans-serif;}'
      + '.pgnov-card{background:#fff;border-radius:18px;max-width:620px;width:100%;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 26px 80px rgba(0,0,0,.5);overflow:hidden;}'
      + '.pgnov-head{background:#0D3040;color:#fff;padding:20px 28px 18px;}'
      + '.pgnov-head .k{font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#A8D4CF;margin-bottom:5px;}'
      + '.pgnov-head h2{margin:0;font-size:21px;font-family:Montserrat,Inter,Arial,sans-serif;font-weight:800;letter-spacing:-.01em;}'
      + '.pgnov-head .s{margin:5px 0 0;font-size:12.5px;color:#9dbac4;}'
      + '.pgnov-list-wrap{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;}'
      + '.pgnov-list{padding:6px 28px 4px;overflow-y:auto;flex:1;}'
      + '.pgnov-scrollhint{position:absolute;left:0;right:0;bottom:0;text-align:center;font-size:11px;font-weight:700;color:#5b6b72;background:linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,.96) 55%);padding:26px 0 9px;pointer-events:none;opacity:0;visibility:hidden;transition:opacity .25s;}'
      + '.pgnov-scrollhint.vis{opacity:1;visibility:visible;}'
      + '.pgnov-sep{height:1px;background:#e6edef;margin:18px 0 14px;}'
      + '.pgnov-it{border-left:4px solid #229A82;background:#F4F9F8;border-radius:0 12px 12px 0;padding:16px 19px;margin:16px 0;}'
      + '.pgnov-it .t{font-size:10px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:#229A82;margin-bottom:6px;}'
      + '.pgnov-it h4{margin:0 0 7px;font-size:15.5px;line-height:1.35;color:#0D3040;font-family:Montserrat,Inter,Arial,sans-serif;font-weight:700;}'
      + '.pgnov-it p{margin:0;font-size:13.5px;line-height:1.62;color:#3a4a50;white-space:pre-wrap;}'
      + '.pgnov-foto{margin:0 0 12px;border-radius:12px;overflow:hidden;background:#e6edef;}'
      + '.pgnov-foto img{display:block;width:100%;max-height:320px;object-fit:cover;}'
      + '.pgnov-pie{font-size:12px;font-weight:600;color:#0D3040;text-align:center;padding:9px 12px;background:#fff;border-radius:0 0 12px 12px;}'
      + '.pgnov-it.felicitacion .pgnov-pie{color:#0a8c47;}'
      + '.pgnov-it.felicitacion{border-color:#00C864;background:#EAFBF1;}.pgnov-it.felicitacion .t{color:#0a8c47;}'
      + '.pgnov-it.aviso{border-color:#FFB400;background:#FFF8E6;}.pgnov-it.aviso .t{color:#a67400;}'
      + '.pgnov-it.recordatorio{border-color:#8da0ad;background:#F3F6F7;}.pgnov-it.recordatorio .t{color:#5b6b72;}'
      + '.pgnov-hero-card{border:1px solid #b9ecd2;border-top:5px solid #00C864;border-radius:16px;overflow:hidden;background:#EAFBF1;margin:14px 0 20px;box-shadow:0 6px 18px rgba(0,150,90,.1);}'
      + '.pgnov-hero-foto{margin:0;background:#d7f5e4;}'
      + '.pgnov-hero-foto img{display:block;width:100%;height:240px;object-fit:cover;}'
      + '.pgnov-hero-body{padding:18px 20px 20px;}'
      + '.pgnov-hero-badge{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:#0a8c47;background:#fff;border:1px solid #b9ecd2;padding:4px 11px;border-radius:99px;margin-bottom:11px;}'
      + '.pgnov-hero-title{margin:0 0 8px;font-size:19.5px;line-height:1.3;color:#0D3040;font-family:Montserrat,Inter,Arial,sans-serif;font-weight:800;}'
      + '.pgnov-hero-text{margin:0;font-size:13.5px;line-height:1.64;color:#3a4a50;white-space:pre-wrap;}'
      + '.pgnov-hero-pie{margin-top:13px;display:inline-block;font-size:12px;font-weight:700;color:#0a8c47;background:#fff;border:1px solid #b9ecd2;border-radius:9px;padding:7px 13px;}'
      + '.pgnov-foot{padding:16px 28px 22px;border-top:1px solid #e6edef;background:#fff;}'
      + '.pgnov-bar{height:6px;border-radius:99px;background:#e6edef;overflow:hidden;margin:0 0 14px;}'
      + '.pgnov-bar i{display:block;height:100%;width:0;background:#FFB400;transition:width .95s linear;}'
      + '.pgnov-foot button{width:100%;padding:14px;border:none;border-radius:11px;background:#229A82;color:#fff;font-weight:700;font-size:14.5px;cursor:pointer;transition:background .2s;font-family:inherit;}'
      + '.pgnov-foot button:hover:not(:disabled){background:#1a7a68;}'
      + '.pgnov-foot button:disabled{background:#cfd9dd;color:#5b6b72;cursor:not-allowed;}'
      + '.pgnov-pausa{background:#FFF8E6;border:1px solid #f2e3bc;color:#a67400;border-radius:9px;padding:9px 12px;font-size:12px;font-weight:600;text-align:center;margin:0 0 12px;display:none;}'
      + '.pgnov-note{font-size:11.5px;color:#8da0ad;text-align:center;margin-top:11px;line-height:1.5;white-space:pre-line;}'
      /* ---- NUEVO v2: banner rojo del bloqueo protegido (D2) ---- */
      + '.pgnov-banner{position:fixed;top:0;left:0;right:0;z-index:2147482000;background:#C0392B;color:#fff;font-family:Inter,Arial,Helvetica,sans-serif;font-size:13.5px;font-weight:600;line-height:1.4;padding:11px 16px;display:flex;align-items:center;justify-content:center;gap:14px;box-shadow:0 4px 14px rgba(0,0,0,.28);}'
      + '.pgnov-banner .msg{max-width:760px;}'
      + '.pgnov-banner button{background:#fff;color:#C0392B;border:none;border-radius:8px;padding:7px 14px;font-weight:800;font-size:12.5px;cursor:pointer;font-family:inherit;white-space:nowrap;}'
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

  /* Título de cabecera: misma redacción del v1. */
  function tituloDe(items) {
    var n1 = items.length;
    var nFelic = 0, i;
    for (i = 0; i < items.length; i++) {
      if ((items[i].tipo || 'novedad') === 'felicitacion') { nFelic++; }
    }
    var titulo = n1 === 1 ? 'Tienes algo por leer' : 'Tienes ' + n1 + ' cosas por leer';
    if (nFelic > 0) {
      titulo += ' · ' + nFelic + (nFelic === 1 ? ' felicitación' : ' felicitaciones') + ' 🎉';
    }
    return titulo;
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
  /* 4. Banner rojo (bloqueo protegido · decisión D2)                      */
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
  /* 6. Overlay lector — copiado del v1, con ganchos nuevos                */
  /* --------------------------------------------------------------------- */

  function abrirOverlay(items, modo) {
    if (!items || !items.length || hayOverlay() || !document.body) { return; }
    asegurarEstilos();
    quitarBanner();

    var tick = null;
    var bloquea = items.some(function (n) { return n.bloqueante !== false; });
    var total = 0;
    items.forEach(function (n) {
      var s = parseInt(n.segundos_lectura, 10);
      if (n.bloqueante !== false && s > total) { total = s; }
    });
    if (bloquea && !total) { total = 90; }

    function tragaEscape(ev) {
      if (ev.key === 'Escape' || ev.keyCode === 27) { ev.preventDefault(); ev.stopImmediatePropagation(); }
    }
    function fondo(on) {
      try {
        document.documentElement.style.overflow = on ? 'hidden' : '';
        document.body.style.overflow = on ? 'hidden' : '';
      } catch (e) {}
    }

    var ov = document.createElement('div');
    ov.id = 'pgnovOv';
    ov.className = 'pgnov-ov';
    var n1 = items.length;

    /* Partición estable: felicitaciones primero (tarjeta héroe), el resto conserva su orden original */
    var heroItems = items.filter(function (n) { return (n.tipo || 'novedad') === 'felicitacion'; });
    var compactItems = items.filter(function (n) { return (n.tipo || 'novedad') !== 'felicitacion'; });

    var html = '<div class="pgnov-card"><div class="pgnov-head"><div class="k">📢 ProtectGo · al día</div>'
      + '<h2 id="pgnovTitulo"></h2><p class="s">Tómate un momento. Esto es lo que pasó desde la última vez que entraste.</p></div>'
      + '<div class="pgnov-list-wrap"><div class="pgnov-list" id="pgnovList">';
    heroItems.forEach(function (n) {
      var t = TIPOS[(n.tipo || 'novedad')] || TIPOS.felicitacion;
      var foto = n.imagen_url ? '<div class="pgnov-hero-foto"><img alt="" loading="lazy"></div>' : '';
      html += '<div class="pgnov-hero-card">' + foto + '<div class="pgnov-hero-body">'
        + '<div class="pgnov-hero-badge">' + t.e + ' ' + t.n + '</div>'
        + '<h3 class="pgnov-hero-title"></h3><p class="pgnov-hero-text"></p>'
        + '<div class="pgnov-hero-pie"></div></div></div>';
    });
    /* Separador sutil solo si hay ambas secciones (héroes + tarjetas compactas) */
    if (heroItems.length && compactItems.length) { html += '<div class="pgnov-sep"></div>'; }
    compactItems.forEach(function (n) {
      var t = TIPOS[(n.tipo || 'novedad')] || TIPOS.novedad;
      var foto = n.imagen_url ? '<div class="pgnov-foto"><img alt="" loading="lazy"><div class="pgnov-pie"></div></div>' : '';
      html += '<div class="pgnov-it ' + t.c + '"><div class="t">' + t.e + ' ' + t.n + '</div>'
        + '<h4></h4>' + foto + '<p></p></div>';
    });
    html += '</div><div class="pgnov-scrollhint" id="pgnovScrollHint">desliza para ver más ▾</div></div>'
      + '<div class="pgnov-foot"><div class="pgnov-pausa" id="pgnovPausa">⏸️ Contador detenido — vuelve a esta ventana para que siga corriendo</div>'
      + '<div class="pgnov-bar" id="pgnovBar"><i id="pgnovFill"></i></div>'
      + '<button id="pgnovBtn" type="button">Ya lo leí, entendido</button>'
      + '<div class="pgnov-note" id="pgnovC"></div></div></div>';
    ov.innerHTML = html;
    document.body.appendChild(ov);

    /* Título por textContent (nunca HTML crudo). */
    var elTitulo = ov.querySelector('#pgnovTitulo');
    elTitulo.textContent = tituloDe(items);

    /* Relleno de texto por datos vía textContent — tarjetas héroe (felicitación) */
    var heroEls = ov.querySelectorAll('.pgnov-hero-card');
    heroItems.forEach(function (n, i) {
      var el = heroEls[i]; if (!el) { return; }
      el.setAttribute('data-pgnov', n.id);   /* v2: para poder quitarla si la desactivan */
      el.querySelector('.pgnov-hero-title').textContent = n.titulo || '';
      el.querySelector('.pgnov-hero-text').textContent = n.cuerpo || '';
      var img = el.querySelector('.pgnov-hero-foto img');
      if (img && n.imagen_url) {
        img.src = n.imagen_url;
        img.alt = n.pie_foto || n.titulo || '';
        img.onerror = function () { var c = this.closest('.pgnov-hero-foto'); if (c) { c.remove(); } };
      }
      var pie = el.querySelector('.pgnov-hero-pie');
      if (pie) { if (n.pie_foto) { pie.textContent = n.pie_foto; } else { pie.remove(); } }
    });

    /* Relleno de texto — tarjetas compactas (novedad / aviso / recordatorio) */
    var its = ov.querySelectorAll('.pgnov-it');
    compactItems.forEach(function (n, i) {
      if (!its[i]) { return; }
      its[i].setAttribute('data-pgnov', n.id);   /* v2 */
      its[i].querySelector('h4').textContent = n.titulo || '';
      its[i].querySelector('p').textContent = n.cuerpo || '';
      var img = its[i].querySelector('.pgnov-foto img');
      if (img && n.imagen_url) {
        img.src = n.imagen_url;
        img.alt = n.pie_foto || n.titulo || '';
        img.onerror = function () { var c = this.closest('.pgnov-foto'); if (c) { c.remove(); } };
        var pie = its[i].querySelector('.pgnov-pie');
        if (pie) { if (n.pie_foto) { pie.textContent = n.pie_foto; } else { pie.remove(); } }
      }
    });

    /* Indicador de scroll: solo aparece si el contenido no cabe, y se apaga cerca del final */
    var listEl = ov.querySelector('#pgnovList'), hint = ov.querySelector('#pgnovScrollHint');
    function actualizaScrollHint() {
      if (!listEl || !hint) { return; }
      var haySobra = listEl.scrollHeight > listEl.clientHeight + 2;
      if (!haySobra) { hint.classList.remove('vis'); return; }
      var cercaFinal = (listEl.scrollTop + listEl.clientHeight) >= (listEl.scrollHeight - 8);
      if (cercaFinal) { hint.classList.remove('vis'); } else { hint.classList.add('vis'); }
    }
    if (listEl) { listEl.addEventListener('scroll', actualizaScrollHint); }
    window.addEventListener('resize', actualizaScrollHint);
    requestAnimationFrame(actualizaScrollHint);

    fondo(bloquea);
    document.addEventListener('keydown', tragaEscape, true);

    var btn = ov.querySelector('#pgnovBtn'), fill = ov.querySelector('#pgnovFill'),
        barra = ov.querySelector('#pgnovBar'), nota = ov.querySelector('#pgnovC'),
        pausa = ov.querySelector('#pgnovPausa');

    /* ---- v2: cierre y retiro de tarjetas para el tiempo real ---- */
    function cerrarTodo(redirigir) {
      if (tick) { clearInterval(tick); tick = null; }
      if (ov && ov.parentNode) { ov.parentNode.removeChild(ov); }
      fondo(false);
      document.removeEventListener('keydown', tragaEscape, true);
      window.removeEventListener('resize', actualizaScrollHint);
      estadoOv = null;
      if (redirigir) {
        try {
          var ruta = location.pathname.replace(/[^\/]*$/, '');
          var enIndex = /(^|\/)index\.html$/i.test(location.pathname) || /\/$/.test(location.pathname);
          if (!enIndex) { location.replace(ruta + 'index.html'); }
        } catch (e) {}
      }
    }

    /* Quita una novedad concreta (la desactivaron mientras estaba abierta). */
    function quitarNovedad(id) {
      var idx = -1, i;
      for (i = 0; i < items.length; i++) { if (String(items[i].id) === String(id)) { idx = i; break; } }
      if (idx < 0) { return; }
      items.splice(idx, 1);
      var nodo = ov.querySelector('[data-pgnov="' + id + '"]');
      if (nodo && nodo.parentNode) { nodo.parentNode.removeChild(nodo); }
      if (!items.length) { cerrarTodo(false); return; }
      /* Quedan otras: seguimos con las que queden. */
      elTitulo.textContent = tituloDe(items);
      var sep = ov.querySelector('.pgnov-sep');
      if (sep && (!ov.querySelector('.pgnov-hero-card') || !ov.querySelector('.pgnov-it'))) {
        sep.parentNode.removeChild(sep);
      }
      actualizaScrollHint();
      /* v2: si la que se fue definía (o inflaba) el tiempo de lectura,
         recalculamos el contador con las que quedan. Nunca lo dejamos
         bloqueado de más ni el botón trabado para siempre. */
      recalcularTiempo();
    }

    /* v2: recalcula el contador de lectura tras retirar una novedad en
       caliente (RLS impide que esto llegue por realtime; lo dispara el
       respaldo de 60 s vía revisarOverlayAbierto -> quitarNovedad). Si el
       tiempo ya transcurrido alcanza o supera el nuevo total, libera el
       botón ya mismo en vez de dejarlo bloqueado con un total que ya no
       existe; si no, sigue contando pero contra el total nuevo. */
    function recalcularTiempo() {
      if (!bloquea || total <= 0) { return; } // nunca hubo contador que ajustar
      var nuevoTotal = 0;
      items.forEach(function (n) {
        var s = parseInt(n.segundos_lectura, 10);
        if (n.bloqueante !== false && s > nuevoTotal) { nuevoTotal = s; }
      });
      if (!nuevoTotal) { nuevoTotal = 90; }
      var transcurrido = total - restante;
      total = nuevoTotal;
      if (transcurrido >= total) {
        restante = 0;
        if (tick) { clearInterval(tick); tick = null; }
        fill.style.width = '100%';
        pausa.style.display = 'none';
        btn.disabled = false; btn.textContent = 'Ya lo leí, entendido';
        nota.textContent = items.length > 1 ? 'Confirmas las ' + items.length + ' de una vez.' : '';
      } else {
        restante = total - transcurrido;
        pinta();
      }
    }

    estadoOv = {
      quitar: quitarNovedad,
      cerrar: cerrarTodo,
      /* v2: ids que sigue mostrando la cola ahora mismo, para que el
         respaldo de 60 s pueda comparar contra lo que diga la RPC. */
      ids: function () { return items.map(function (n) { return String(n.id); }); }
    };

    btn.addEventListener('click', function () {
      if (btn.disabled) { return; }
      btn.disabled = true; btn.textContent = 'Guardando…';
      Promise.all(items.map(function (n) {
        return cliente.rpc('marcar_novedad_leida', { p_novedad_id: n.id });
      }))
      .then(function (res) {
        var fallo = res.some(function (x) { return x && x.error; });
        if (fallo) {
          btn.disabled = false; btn.textContent = 'Reintentar';
          nota.textContent = 'No se pudo registrar la lectura. Revisa tu conexión e inténtalo otra vez.';
          return;
        }
        /* v1 mandaba al index después de leer. Se quita el redirect en TODOS
           los modos: coi, fam, kam y rrhh venían de un widget viejo que nunca
           sacaba a nadie de la página, y con el widget unificado la persona
           terminaba devuelta al índice del portal y perdía dónde estaba
           trabajando (reportes de "se dañó KAM"). cerrarTodo(false) solo
           limpia el overlay, el fondo y el estado; nunca navega. */
        cerrarTodo(false);
      })
      ['catch'](function () {
        btn.disabled = false; btn.textContent = 'Reintentar';
        nota.textContent = 'No se pudo registrar la lectura. Revisa tu conexión e inténtalo otra vez.';
      });
    });

    if (!bloquea || total <= 0) { barra.style.display = 'none'; nota.textContent = ''; return; }

    var restante = total;
    btn.disabled = true;
    function leyendo() {
      try { return document.visibilityState === 'visible' && document.hasFocus(); }
      catch (e) { return document.visibilityState === 'visible'; }
    }
    function pinta() {
      var m = Math.floor(restante / 60), s = restante % 60;
      btn.textContent = 'Podrás continuar en ' + m + ':' + (s < 10 ? '0' : '') + s;
      fill.style.width = Math.round(((total - restante) / total) * 100) + '%';
      var quieto = !leyendo();
      pausa.style.display = quieto ? 'block' : 'none';
      nota.textContent = quieto ? '' : 'El contador solo avanza mientras estés en esta ventana.';
    }
    pinta();
    ['blur', 'focus', 'visibilitychange'].forEach(function (ev) {
      (ev === 'visibilitychange' ? document : window).addEventListener(ev, function () {
        if (restante > 0) { pinta(); }
      }, true);
    });
    tick = setInterval(function () {
      if (!leyendo()) { pinta(); return; }
      restante--;
      if (restante <= 0) {
        clearInterval(tick); tick = null; fill.style.width = '100%';
        pausa.style.display = 'none';
        btn.disabled = false; btn.textContent = 'Ya lo leí, entendido';
        nota.textContent = items.length > 1 ? 'Confirmas las ' + items.length + ' de una vez.' : '';
        return;
      }
      pinta();
    }, 1000);

    console.log('[pg-novedades] overlay abierto (' + n1 + ' pendiente(s), modo ' + modo + ')');
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
         mientras el overlay sigue abierto y retira cualquier id que ya no
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

  /* v2: con el overlay YA abierto, este es el que de verdad cierra en
     caliente una novedad que el admin bajó (activo=false) o que venció.
     Por qué hace falta: el RLS de lectura de public.novedades exige
     activo = true, y Realtime respeta ese RLS, así que el evento UPDATE de
     "la bajaron" nunca le llega al usuario (ver el comentario grande en
     alRecibirEvento). Por eso, en vez de esperar un evento que no va a
     llegar, cada 60 s le volvemos a preguntar a novedades_pendientes(area)
     y comparamos contra los ids que la cola sigue mostrando en pantalla:
       - id que ya no viene en la respuesta -> se quitó (quitarNovedad, que
         además recalcula el contador de lectura si hacía falta).
       - si con eso la cola queda vacía -> se cierra sola (cerrarTodo, la
         misma ruta de cuando la persona termina de leer).
     Esta función NUNCA abre un overlay nuevo (esa ruta es 'revisar', más
     arriba, y no se toca) ni interfiere con el banner rojo del formulario
     sucio: solo actúa si ya había un overlay abierto de antes. */
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
       Si el overlay ya está abierto, 'revisar' no hace nada (ver su propio
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
  /* 9. API pública — MISMA FIRMA que el v1                                */
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

  /* Ganchos de auditoría en vivo (consola del navegador). */
  window.__pgnovDiag = function () {
    return {
      version: window.PG_NOVEDADES_VERSION,
      area: areaActual,
      canal: !!window.__pgnovCanal,
      estadoCanal: window.__pgnovCanal && window.__pgnovCanal.state,
      formSucio: !!window.pgFormSucio,
      overlay: hayOverlay(),
      banner: hayBanner()
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

  console.log('[pg-novedades] v2.0 activo — realtime');
})();

/* ============================================================================
 * TODO pendientes (documentados también en NOTAS-novedades.md)
 * ---------------------------------------------------------------------------
 * TODO: verificar en Supabase que la tabla public.novedades esté en la
 *       publicación de Realtime (Database > Replication > supabase_realtime).
 *       Sin eso el canal se suscribe pero nunca llegan eventos y todo queda
 *       dependiendo del respaldo de 60 s.
 * RESUELTO (auditoría H5): ya no redirige al index en ningún modo, ni al
 *       terminar de leer ni al quedar la cola vacía — así coi, fam, kam y
 *       rrhh no sacan a la persona de donde estaba trabajando.
 * TODO (Módulo B): pgNovedadesAuto crea su propio cliente con la gaveta
 *       compartida envuelta en un proxy de SOLO LECTURA (setItem/removeItem
 *       no hacen nada). Si algún día una página cambia el storageKey por
 *       defecto de su cliente, el arranque automático dejaría de ver la
 *       sesión y se quedaría reintentando cada 5 s (no rompe la página).
 * TODO (Módulo B): la vigilancia de token llama realtime.setAuth() cada 60 s
 *       cuando detecta un access_token nuevo. Verificar en producción, con el
 *       JWT vencido de verdad, que el canal se re-autentica y que las RPC
 *       vuelven solas (deberían: cada llamada REST relee la gaveta).
 * TODO: la detección de "formulario sucio" es genérica. Si alguna página tiene
 *       un campo raro que dispare falsos positivos, se puede excluir por id
 *       agregándolo a IDS_LOGIN o poniéndole class="pgnov-ignorar" y ampliando
 *       campoExcluido().
 * ==========================================================================*/
