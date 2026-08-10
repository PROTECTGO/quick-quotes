/* ============================================================================
   pg-auth.js  ·  ProtectGo  ·  v1.0
   ----------------------------------------------------------------------------
   Qué hace: agrega el enlace "¿Olvidaste tu contraseña?" debajo del botón
   "Entrar" en TODAS las páginas internas que tienen login, sin tocar el login
   que ya existe ni su lógica.

   Cómo se usa: en el <head> de cada página, SIN defer ni async:
     <script src="https://protectgo.github.io/quick-quotes/pg-auth.js"></script>

   REGLA DURA: este archivo se ejecuta ANTES de que exista <body>, así que
   aquí arriba NO se puede tocar el DOM. Todo el trabajo arranca en
   DOMContentLoaded (o de una si el documento ya terminó de cargar).
   ========================================================================== */
(function () {
  "use strict";

  /* ---------------------------------------------------------------- config */
  var SUPABASE_URL = "https://bwqzypuiqgxzsrtsueab.supabase.co";
  var SUPABASE_KEY = "sb_publishable_VbA94M3mF-Z6kgtPnda-cQ_diKF8L49";
  var REDIRECT_URL = "https://protectgo.github.io/quick-quotes/recuperar.html";
  var DOMINIO      = "@protectgoservices.com";
  var SOPORTE      = "sales@protectgoservices.com";

  // Mensajes fijos (siempre el mismo, exista o no la cuenta: nunca revelamos nada)
  var MSG_OK = "Si ese correo tiene cuenta, ya te llegó un enlace para crear tu " +
               "contraseña nueva. Revisa tu bandeja (y el correo no deseado). " +
               "El enlace dura 1 hora.";
  var MSG_LIMITE = "Ya se pidió un enlace hace poco. Espera un minuto y vuelve a intentar.";
  var MSG_SALIDA = "¿Es una cuenta de área (fam@, kam@, coi@…) o no te llega? " +
                   "Escríbele a " + SOPORTE + " para que te la restablezca.";

  var MAX_ESPERA_SUPABASE = 10000; // 10 s esperando que cargue supabase-js
  var MAX_ESPERA_LOGIN    = 45000; // 45 s vigilando el DOM por si el login aparece después (quick-quote.html arma el login por JS; con internet lento puede tardar más de 15 s)

  window.PG_AUTH_VERSION = "1.1";
  console.log("[pg-auth] v1.1 activo");

  /* ------------------------------------------------------- cliente propio */
  /* Creamos NUESTRO propio cliente de Supabase: la variable `sb` de cada
     página vive dentro de un closure y no la podemos alcanzar desde aquí.
     Usamos persistSession:false y un storageKey aparte para NO pisarle la
     sesión al login de la página. */
  var sb = null;

  function crearCliente() {
    if (sb) return sb;
    if (!(window.supabase && window.supabase.createClient)) return null;
    try {
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          /* IMPORTANTE: flujo 'implicit' a propósito. Con PKCE, Supabase guarda
             un "code verifier" en el navegador y recuperar.html tendría que
             encontrarlo con la MISMA llave de almacenamiento; como aquí no
             persistimos sesión (para no pisarle el login a la página), ese
             verificador se perdería. Con 'implicit' el enlace del correo llega
             como #access_token=...&type=recovery y recuperar.html lo lee solo. */
          flowType: "implicit",
          storageKey: "pg-auth-recuperacion"
        }
      });
    } catch (e) {
      console.log("[pg-auth] no se pudo crear el cliente:", e);
      sb = null;
    }
    return sb;
  }

  // Espera a que supabase-js exista (hasta 10 s) y luego llama a cb(cliente).
  function conCliente(cb) {
    var c = crearCliente();
    if (c) { cb(c); return; }
    var t0 = Date.now();
    var timer = setInterval(function () {
      var cli = crearCliente();
      if (cli) { clearInterval(timer); cb(cli); return; }
      if (Date.now() - t0 > MAX_ESPERA_SUPABASE) {
        clearInterval(timer);
        cb(null);
      }
    }, 250);
  }

  /* ------------------------------------------------------------- utilidad */

  function esVisible(el) {
    if (!el) return false;
    if (el.offsetParent !== null) return true;
    var r = el.getBoundingClientRect();
    return (r.width > 0 && r.height > 0);
  }

  // getComputedStyle blindado (navegadores viejos / nodos raros)
  function estilo(el) {
    try {
      if (el && el.nodeType === 1 && window.getComputedStyle) return window.getComputedStyle(el);
    } catch (e) {}
    return null;
  }

  // ¿El navegador ya midió la página? En las pruebas con jsdom todo mide 0,
  // así que ahí NO podemos concluir nada por tamaño.
  function hayLayout() {
    try { return !!(document.body && document.body.offsetHeight > 0); } catch (e) { return false; }
  }

  /* --------------------------------------------- modo compacto (barra) */
  /* En casi todas las páginas el login es una tarjeta dentro de una ventana
     que tapa la pantalla (.ov / #login, position:fixed). Ahí el panel va
     debajo del botón, como siempre. Pero en mapa-puestos.html el login son
     dos campitos metidos en la barra de arriba: si le colgamos un bloque,
     le deformamos la barra. Para esas usamos "modo compacto". */

  // ¿El campo está dentro de una ventana que tapa la pantalla completa?
  // CONSERVADOR: si no se puede medir, respondemos que SÍ (=> modo normal,
  // el de toda la vida). Nunca cambiamos por las malas lo que ya funciona.
  function dentroDeOverlay(el) {
    var n = el ? el.parentNode : null, saltos = 0;
    while (n && n.nodeType === 1 && saltos < 12) {
      var st = estilo(n);
      var pos = st ? st.position : "";
      if (pos === "fixed" || pos === "absolute") {
        if (!hayLayout()) return true;              // sin medidas: asumimos overlay
        var r = n.getBoundingClientRect();
        var W = window.innerWidth || 0, H = window.innerHeight || 0;
        if (!W || !H) return true;
        if (r.width >= W * 0.8 && r.height >= H * 0.8) return true;
      }
      if (n === document.body) break;
      n = n.parentNode; saltos++;
    }
    return false;
  }

  // Firma de "barra": sin títulos, sin etiquetas, sin párrafos y con pocos
  // hijos. Solo se usa cuando el navegador todavía no midió nada (pruebas).
  function pareceBarra(cont) {
    if (!cont) return false;
    if (cont.querySelector("h1, h2, h3, h4, label, p")) return false;
    var hijos = cont.children ? cont.children.length : 0;
    return (hijos > 0 && hijos <= 8);
  }

  function esCompacto(pass, cont) {
    if (!cont) return false;
    if (dentroDeOverlay(pass)) return false;        // overlay => modo normal
    var alto = cont.offsetHeight || 0;
    if (alto >= 90) return false;                   // caja alta => es tarjeta
    if (alto > 0) return true;                      // barra angosta de verdad
    return pareceBarra(cont);                       // sin medidas: por estructura
  }

  // ¿El campo de contraseña quedó escondido? (la página esconde el login al
  // entrar, a veces campo por campo). Sirve con o sin medidas reales.
  function estaOculto(el) {
    if (!el) return true;
    if (!document.body || !document.body.contains(el)) return true;  // lo sacaron del DOM
    var n = el, saltos = 0;
    while (n && n.nodeType === 1 && saltos < 30) {
      var st = estilo(n);
      if (st) {
        if (st.display === "none") return true;
        if (st.visibility === "hidden" || st.visibility === "collapse") return true;
      }
      if (n === document.body) break;
      n = n.parentNode; saltos++;
    }
    if (hayLayout() && el.offsetParent === null) {
      var st2 = estilo(el);
      if (!st2 || st2.position !== "fixed") return true;
    }
    return false;
  }

  // Nombre del archivo actual, en minúsculas ("coi.html", "index.html", …)
  function archivoActual() {
    var p = (location.pathname || "").split("?")[0].split("#")[0];
    var partes = p.split("/");
    return (partes[partes.length - 1] || "").toLowerCase();
  }

  // En recuperar.html NUNCA metemos el enlace (esa página YA es la recuperación).
  function esPaginaRecuperar() {
    return archivoActual().indexOf("recuperar") === 0;
  }

  // Le agrega el dominio si la persona escribió solo el usuario.
  // Regla REAL tomada de pendientes/index.html (tryLogin):
  //   if(!u.includes('@')) u += '@protectgoservices.com';
  function normalizarCorreo(v) {
    var s = String(v || "").trim().toLowerCase();
    if (!s) return "";
    if (s.indexOf("@") < 0) s = s + DOMINIO;
    return s;
  }

  // ¿El error de Supabase es por límite de envíos?
  function esLimiteDeEnvio(err) {
    if (!err) return false;
    if (err.status === 429 || err.statusCode === 429) return true;
    var m = String(err.message || err.error_description || err.code || "").toLowerCase();
    return (m.indexOf("rate limit") >= 0 ||
            m.indexOf("over_email_send_rate_limit") >= 0 ||
            m.indexOf("too many requests") >= 0 ||
            m.indexOf("email rate") >= 0);
  }

  /* --------------------------------------------------------------- estilos */

  function ponerEstilos() {
    if (document.getElementById("pgAuthStyle")) return;
    var st = document.createElement("style");
    st.id = "pgAuthStyle";
    st.textContent = [
      /* El enlace: chiquito, verde ProtectGo. Va con color explícito para que
         se vea igual sobre tarjeta blanca o sobre overlay oscuro. */
      "#pgRecLink{display:block;margin:10px 0 0;text-align:center;",
      "font:600 12.5px/1.4 Inter,Arial,Helvetica,sans-serif;",
      "color:#229A82 !important;text-decoration:none;cursor:pointer;",
      "text-shadow:none;background:none;border:none;padding:2px 0;}",
      "#pgRecLink:hover{text-decoration:underline;color:#1a7a68 !important;}",

      /* Panel inline (nada de prompt()) */
      "#pgRecPanel{display:none;margin:10px 0 0;padding:13px 14px;",
      "background:#F4F9F8;border:1px solid #e6edef;border-radius:12px;",
      "font-family:Inter,Arial,Helvetica,sans-serif;text-align:left;}",
      "#pgRecPanel.pg-abierto{display:block;}",
      "#pgRecPanel .pg-t{font:700 13px Montserrat,Arial,Helvetica,sans-serif;",
      "color:#0D3040;margin:0 0 4px;}",
      "#pgRecPanel .pg-sub{font-size:11.5px;color:#5b6b72;margin:0 0 9px;line-height:1.45;}",
      "#pgRecPanel input{width:100%;box-sizing:border-box;padding:9px 11px;",
      "border:1px solid #cdd9dd;border-radius:9px;font-size:13px;color:#0D3040;",
      "background:#fff;font-family:Inter,Arial,Helvetica,sans-serif;}",
      "#pgRecPanel input:focus{outline:none;border-color:#229A82;}",
      "#pgRecPanel .pg-fila{display:flex;gap:7px;margin-top:9px;}",
      "#pgRecPanel button{flex:1;padding:9px 10px;border:none;border-radius:9px;",
      "font:700 12.5px Inter,Arial,Helvetica,sans-serif;cursor:pointer;}",
      "#pgRecEnviar{background:#229A82;color:#fff;}",
      "#pgRecEnviar:hover{background:#1a7a68;}",
      "#pgRecEnviar[disabled]{opacity:.6;cursor:default;}",
      "#pgRecCerrar{background:#e6edef;color:#0D3040;flex:0 0 92px;}",
      "#pgRecMsg{margin-top:9px;font-size:11.8px;line-height:1.5;color:#0D3040;display:none;}",
      "#pgRecMsg.pg-ver{display:block;}",
      "#pgRecMsg.pg-alerta{color:#a05a00;}",
      "#pgRecSalida{margin-top:7px;font-size:11px;line-height:1.5;color:#5b6b72;display:none;}",
      "#pgRecSalida.pg-ver{display:block;}",
      "#pgRecSalida a{color:#229A82;text-decoration:none;font-weight:600;}",

      /* --- MODO COMPACTO: el login vive dentro de una barra angosta --- */
      /* El enlace no puede romper la barra: chiquito, en línea y sin cortarse. */
      "#pgRecLink.pg-compacto{display:inline;margin:0 0 0 8px;padding:0;",
      "white-space:nowrap;font-size:11px;line-height:1;vertical-align:middle;",
      "text-align:left;}",

      /* El MISMO panel, pero abierto como ventana flotante centrada. */
      "#pgRecModal{display:none;position:fixed;top:0;left:0;right:0;bottom:0;",
      "background:rgba(0,30,40,.55);z-index:2147483000;",
      "align-items:center;justify-content:center;padding:16px;}",
      "#pgRecModal.pg-abierto{display:flex;}",
      "#pgRecCaja{position:relative;background:#fff;border-radius:14px;",
      "box-shadow:0 10px 34px rgba(0,30,40,.35);padding:16px;",
      "width:100%;max-width:340px;box-sizing:border-box;",
      "font-family:Inter,Arial,Helvetica,sans-serif;}",
      "#pgRecCaja #pgRecPanel{margin:0;}",
      "#pgRecX{position:absolute;top:5px;right:7px;background:none;border:none;",
      "font:700 15px Arial,Helvetica,sans-serif;color:#5b6b72;cursor:pointer;",
      "line-height:1;padding:4px 6px;}",
      "#pgRecX:hover{color:#0D3040;}"
    ].join("");
    (document.head || document.documentElement).appendChild(st);
  }

  /* ------------------------------------ detección genérica del formulario */
  /* Los ids cambian por página (#email/#pass, #qqEmail/#qqPass,
     #emailInput/#passInput, #loginEmail/#loginPass, #lu/#lp…), así que
     detectamos por estructura: partimos del campo de contraseña. */

  function camposDePassword() {
    var todos = document.querySelectorAll('input[type="password"]');
    var visibles = [], cualquiera = [];
    var i, el;
    for (i = 0; i < todos.length; i++) {
      el = todos[i];
      if (el.getAttribute("data-pg-rec") === "no") continue;
      cualquiera.push(el);
      if (esVisible(el)) visibles.push(el);
    }
    // Preferimos el visible; si ninguno se ve todavía (overlays que abren
    // después, como quick-quote.html), servimos el que exista en el DOM.
    return visibles.length ? visibles : cualquiera;
  }

  // Sube desde el input hasta un contenedor razonable (form, .card, overlay…)
  function contenedorDe(pass) {
    var n = pass.parentNode, saltos = 0;
    var mejor = pass.parentNode;
    while (n && n.nodeType === 1 && saltos < 6) {
      if (n.tagName === "FORM") return n;
      // Un contenedor sirve si adentro hay password + algún botón/campo de correo
      if (n.querySelector('input[type="email"], input[type="text"]') &&
          n.querySelector('button, input[type="submit"]')) {
        mejor = n;
        break; // nos quedamos con el contenedor MÁS CERCANO, no el más externo
      }
      n = n.parentNode; saltos++;
    }
    return mejor || pass.parentNode;
  }

  // ¿Es un formulario de CAMBIO de clave y no de entrada? -> no tocarlo.
  function esCambioDeClave(pass, cont) {
    // Dos o más campos de contraseña en el mismo contenedor = cambio de clave
    if (cont && cont.querySelectorAll('input[type="password"]').length > 1) return true;
    var pista = ((pass.id || "") + " " + (pass.name || "") + " " +
                 (pass.getAttribute("placeholder") || "") + " " +
                 (pass.getAttribute("autocomplete") || "")).toLowerCase();
    if (/new-password|nueva|nuevo|confirm|repet|repite|actual2/.test(pista)) return true;
    return false;
  }

  // Campo de correo asociado: input[type=email] del contenedor, o el
  // input[type=text] anterior más cercano al campo de contraseña.
  function campoCorreoDe(pass, cont) {
    if (!cont) return null;
    var mail = cont.querySelector('input[type="email"]');
    if (mail) return mail;

    var lista = cont.querySelectorAll("input");
    var idx = -1, i;
    for (i = 0; i < lista.length; i++) { if (lista[i] === pass) { idx = i; break; } }
    if (idx < 0) return null;
    for (i = idx - 1; i >= 0; i--) {
      var t = (lista[i].type || "text").toLowerCase();
      if (t === "text" || t === "email") return lista[i];
    }
    return null;
  }

  // Botón de entrar: el botón más cercano al campo de contraseña (preferimos
  // el que viene DESPUÉS, que es como están armadas todas las páginas).
  function botonDe(pass, cont) {
    if (!cont) return null;
    var btns = cont.querySelectorAll('button, input[type="submit"]');
    if (!btns.length) return null;
    var despues = null, antes = null, i, rel;
    for (i = 0; i < btns.length; i++) {
      rel = pass.compareDocumentPosition(btns[i]);
      if (rel & Node.DOCUMENT_POSITION_FOLLOWING) { if (!despues) despues = btns[i]; }
      else { antes = btns[i]; }
    }
    return despues || antes || btns[0];
  }

  /* ------------------------------------------------- panel de recuperación */

  function construirPanel(inputCorreo) {
    var panel = document.createElement("div");
    panel.id = "pgRecPanel";
    panel.innerHTML =
      '<div class="pg-t">Recuperar contraseña</div>' +
      '<div class="pg-sub">Escribe tu correo y te mandamos un enlace para crear una nueva.</div>' +
      '<input id="pgRecMail" type="text" autocomplete="username" placeholder="nombre.apellido">' +
      '<div class="pg-fila">' +
        '<button type="button" id="pgRecEnviar">Enviar enlace</button>' +
        '<button type="button" id="pgRecCerrar">Cancelar</button>' +
      '</div>' +
      '<div id="pgRecMsg"></div>' +
      '<div id="pgRecSalida"></div>';
    return panel;
  }

  /* Abrir/cerrar: UNA sola lógica para los dos modos. En modo normal solo
     manda la clase del panel; en modo compacto además prende la ventana
     flotante. Nada de alert/confirm/prompt. */
  function panelAbierto() {
    var p = document.getElementById("pgRecPanel");
    return !!(p && p.className.indexOf("pg-abierto") >= 0);
  }

  function cerrarPanel() {
    var p = document.getElementById("pgRecPanel");
    if (p) p.className = "";
    var m = document.getElementById("pgRecModal");
    if (m) m.className = "";
  }

  function abrirPanel(inputCorreo) {
    var p = document.getElementById("pgRecPanel");
    if (!p) return;
    p.className = "pg-abierto";
    var m = document.getElementById("pgRecModal");
    if (m) m.className = "pg-abierto";
    var campo = document.getElementById("pgRecMail");
    if (campo) {
      // Precargado con lo que la persona ya escribió arriba
      var yaEscrito = inputCorreo && inputCorreo.value ? String(inputCorreo.value).trim() : "";
      campo.value = yaEscrito;
      try { campo.focus(); } catch (err) {}
    }
  }

  // Ventana flotante centrada con fondo oscuro. Envuelve el MISMO panel:
  // no se duplica ni el formulario, ni el envío, ni los mensajes.
  // TODO: cerrar también con la tecla Esc y devolver el foco al enlace.
  function construirModal(panel) {
    var modal = document.createElement("div");
    modal.id = "pgRecModal";
    var caja = document.createElement("div");
    caja.id = "pgRecCaja";
    var x = document.createElement("button");
    x.id = "pgRecX";
    x.type = "button";
    x.setAttribute("aria-label", "Cerrar");
    x.innerHTML = "&#10005;";
    caja.appendChild(x);
    caja.appendChild(panel);
    modal.appendChild(caja);
    x.addEventListener("click", function () { cerrarPanel(); });
    modal.addEventListener("click", function (e) {
      if (e.target === modal) cerrarPanel();   // clic en el fondo oscuro = cerrar
    });
    return modal;
  }

  function pintarSalida() {
    var s = document.getElementById("pgRecSalida");
    if (!s) return;
    s.innerHTML = "¿Es una cuenta de área (fam@, kam@, coi@…) o no te llega? " +
                  'Escríbele a <a href="mailto:' + SOPORTE + '">' + SOPORTE + "</a> " +
                  "para que te la restablezca.";
    s.className = "pg-ver";
  }

  function mostrarMensaje(texto, esAlerta) {
    var m = document.getElementById("pgRecMsg");
    if (!m) return;
    m.textContent = texto;
    m.className = "pg-ver" + (esAlerta ? " pg-alerta" : "");
    pintarSalida();
  }

  function enviarEnlace(correoCrudo) {
    var correo = normalizarCorreo(correoCrudo);
    var btn = document.getElementById("pgRecEnviar");

    if (!correo || correo.indexOf("@") < 1) {
      mostrarMensaje("Escribe tu usuario o tu correo completo.", true);
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = "Enviando…"; }
    mostrarMensaje("Enviando…", false);

    conCliente(function (cli) {
      function terminar(texto, alerta) {
        if (btn) { btn.disabled = false; btn.textContent = "Enviar enlace"; }
        mostrarMensaje(texto, alerta);
      }
      if (!cli) {
        terminar("No se pudo conectar. Revisa tu internet y vuelve a intentar.", true);
        return;
      }
      try {
        cli.auth.resetPasswordForEmail(correo, { redirectTo: REDIRECT_URL })
          .then(function (r) {
            if (r && r.error && esLimiteDeEnvio(r.error)) { terminar(MSG_LIMITE, true); return; }
            // Exista o no la cuenta, SIEMPRE el mismo mensaje neutro.
            terminar(MSG_OK, false);
          })
          .catch(function (e) {
            if (esLimiteDeEnvio(e)) { terminar(MSG_LIMITE, true); return; }
            terminar(MSG_OK, false);
          });
      } catch (e) {
        terminar(MSG_OK, false);
      }
    });
  }

  /* ------------------------------------------- vigilante de visibilidad */
  /* Regla general para TODAS las páginas: si la página esconde el login al
     entrar (a veces campo por campo, como mapa-puestos), el enlace se
     esconde con él y el panel se cierra. Si el login reaparece (al salir),
     el enlace vuelve. Chequeo liviano: solo LEE el DOM, cada 1,5 s. */
  var vigilante = null;

  function vigilarVisibilidad(pass) {
    if (vigilante) { clearInterval(vigilante); vigilante = null; }
    function revisarVisibilidad() {
      var link = document.getElementById("pgRecLink");
      if (!link) { if (vigilante) { clearInterval(vigilante); vigilante = null; } return; }
      if (estaOculto(pass)) {
        if (link.getAttribute("data-pg-oculto") !== "1") {
          link.setAttribute("data-pg-oculto", "1");
          link.style.display = "none";
          cerrarPanel();
        }
      } else if (link.getAttribute("data-pg-oculto") === "1") {
        link.removeAttribute("data-pg-oculto");
        link.style.display = "";   // vuelve a lo que diga el CSS
      }
    }
    try {
      /* OJO (re-auditoría): NO se hace una primera revisión inmediata a
         propósito. Adelantarla escondería el enlace en el instante de
         insertarlo en las páginas cuyo login todavía no se ha mostrado, y
         el enlace tardaría hasta 1,5 s en aparecer en TODAS. El costo de
         dejarlo así es un parpadeo de <1,5 s del enlace en la barra de
         mapa-puestos cuando la persona ya tiene sesión. */
      vigilante = setInterval(revisarVisibilidad, 1500);
    } catch (e) {}
  }

  /* ------------------------------------------------------------ inserción */

  function insertarEnlace() {
    if (document.getElementById("pgRecLink")) return true;  // ya está, nunca dos veces
    if (esPaginaRecuperar()) return true;                   // aquí NO va
    if (!document.body) return false;

    var candidatos = camposDePassword();
    var i, pass, cont;
    for (i = 0; i < candidatos.length; i++) {
      pass = candidatos[i];
      cont = contenedorDe(pass);
      if (esCambioDeClave(pass, cont)) continue;            // no es login
      var mail = campoCorreoDe(pass, cont);
      var btn  = botonDe(pass, cont);

      ponerEstilos();

      // ¿Login de barra angosta (mapa-puestos) o tarjeta de siempre?
      var compacto = esCompacto(pass, cont);

      var link = document.createElement("a");
      link.id = "pgRecLink";
      link.href = "javascript:void(0)";
      link.textContent = compacto ? "¿Olvidaste tu clave?" : "¿Olvidaste tu contraseña?";
      if (compacto) link.className = "pg-compacto";

      var panel = construirPanel(mail);

      // El enlace va justo debajo del botón de entrar; si no hay botón,
      // debajo del campo de contraseña.
      var ancla = btn || pass;
      var padre = ancla.parentNode;
      if (!padre) return false;
      padre.insertBefore(link, ancla.nextSibling);
      if (compacto) {
        // El panel NO entra a la barra (la deformaría): se abre como ventana
        // flotante centrada sobre fondo oscuro.
        document.body.appendChild(construirModal(panel));
      } else {
        padre.insertBefore(panel, link.nextSibling);
      }

      // Abrir / cerrar el panel
      link.addEventListener("click", function (e) {
        if (e && e.preventDefault) e.preventDefault();
        if (panelAbierto()) cerrarPanel(); else abrirPanel(mail);
      });

      panel.querySelector("#pgRecCerrar").addEventListener("click", function () {
        cerrarPanel();
      });

      panel.querySelector("#pgRecEnviar").addEventListener("click", function () {
        var campo = document.getElementById("pgRecMail");
        enviarEnlace(campo ? campo.value : "");
      });

      // Enter dentro del campo = enviar (y NO dispara el submit del login)
      panel.querySelector("#pgRecMail").addEventListener("keydown", function (e) {
        if (e.keyCode === 13) {
          if (e.preventDefault) e.preventDefault();
          if (e.stopPropagation) e.stopPropagation();
          enviarEnlace(this.value);
        }
      });

      // Si la página esconde el login al entrar, el enlace se va con él.
      vigilarVisibilidad(pass);

      console.log("[pg-auth] enlace de recuperación insertado (modo " +
                  (compacto ? "compacto" : "normal") + ")");
      return true;
    }
    return false;
  }

  /* -------------------------------------------------------------- arranque */

  function arrancar() {
    if (esPaginaRecuperar()) {
      console.log("[pg-auth] estoy en recuperar.html: no inserto nada");
      return;
    }

    // Precalentamos el cliente (sin bloquear nada)
    conCliente(function (cli) {
      if (!cli) console.log("[pg-auth] supabase-js no cargó en 10 s");
    });

    if (insertarEnlace()) return;

    // En varias páginas el overlay de login aparece después: vigilamos el DOM
    // durante 15 s y luego soltamos.
    var obs = null, corte = null;
    function apagar() {
      if (obs) { try { obs.disconnect(); } catch (e) {} obs = null; }
      if (corte) { clearTimeout(corte); corte = null; }
    }
    try {
      obs = new MutationObserver(function () {
        if (insertarEnlace()) apagar();
      });
      obs.observe(document.body || document.documentElement, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ["style", "class"]
      });
      corte = setTimeout(function () {
        apagar();
        console.log("[pg-auth] corte a los 15 s: no encontré formulario de login");
      }, MAX_ESPERA_LOGIN);
    } catch (e) {
      // Navegador viejo sin MutationObserver: reintento simple
      var n = 0;
      var t = setInterval(function () {
        n++;
        if (insertarEnlace() || n > 30) clearInterval(t);
      }, 500);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", arrancar);
  } else {
    arrancar();
  }
})();
