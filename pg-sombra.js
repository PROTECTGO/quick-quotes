/* ============================================================
   GABI · pg-sombra.js — la métrica del mes que sigue a la persona
   por todas las herramientas del portal.

   Qué es: una píldora chiquita, fija abajo a la derecha, con lo que
   lleva este mes contra SU meta (la misma de Mi proceso y del tablero
   del equipo: premium + fee contra meta_de_agente). Un toque abre
   Mi proceso.

   Por qué funciona: siempre el mismo sitio, el mismo tamaño y el mismo
   número. No pide nada, no bloquea nada, no cambia de color. Solo late
   una vez cuando el número sube. La repetición en el mismo lugar es lo
   que se vuelve inconsciente.

   Cómo se usa: una línea en cada página, después del script de Supabase.
     <script src="pg-sombra.js"></script>
   Nada más. Si la RPC falla o la persona no es asesor, no se pinta nada
   y la herramienta sigue igual (fail-silent, nunca fail-loud).

   NO escribe nada de negocio. Lo único que registra es la apertura de
   Mi proceso desde aquí (portal.aperturas), para saber si la sombra
   sirve de verdad.
   ============================================================ */
(function (global) {
  'use strict';

  var URL_SB   = 'https://hivpqsepwsfmafamxkzy.supabase.co';
  var KEY_SB   = 'sb_publishable_Kak00GbGVt2K3yGh6IBZvw_99IybVvt';
  var DESTINO  = 'https://protectgo.github.io/quick-quotes/gabi-asesor.html';
  var CACHE_MS = 10 * 60 * 1000;          // 10 minutos: se llama en cada pantalla
  var LLAVE    = 'pgSombra.v1';

  function guardado() {
    try {
      var raw = global.sessionStorage.getItem(LLAVE);
      if (!raw) return null;
      var o = JSON.parse(raw);
      return (o && o.t && (Date.now() - o.t) < CACHE_MS) ? o : null;
    } catch (e) { return null; }
  }
  function guardar(d) {
    try { global.sessionStorage.setItem(LLAVE, JSON.stringify({ t: Date.now(), d: d })); }
    catch (e) { /* modo privado: la sombra sigue funcionando, solo sin cache */ }
  }
  function anterior() {
    try {
      var raw = global.localStorage.getItem(LLAVE + '.mc');
      return raw === null ? null : Number(raw);
    } catch (e) { return null; }
  }
  function recordar(mc) {
    try { global.localStorage.setItem(LLAVE + '.mc', String(mc)); } catch (e) {}
  }

  function usd(n) {
    n = Math.round(Number(n) || 0);
    return '$' + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  function estilos() {
    if (document.getElementById('pgsombra-css')) return;
    var st = document.createElement('style');
    st.id = 'pgsombra-css';
    st.textContent =
      '#pgSombra{position:fixed;right:20px;bottom:20px;z-index:99990;display:flex;align-items:center;gap:10px;' +
        'background:#1B2D3A;color:#fff;border:0;border-radius:999px;padding:7px 15px 7px 7px;cursor:pointer;' +
        'font:600 12.5px/1.2 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;' +
        'box-shadow:0 6px 22px rgba(13,48,64,.26);opacity:0;transform:translateY(8px);' +
        'transition:opacity .35s ease,transform .35s ease,box-shadow .2s ease;}' +
      '#pgSombra.pgs-in{opacity:1;transform:translateY(0);}' +
      '#pgSombra:hover{box-shadow:0 10px 28px rgba(13,48,64,.34);}' +
      '#pgSombra .pgs-anillo{position:relative;width:32px;height:32px;flex:0 0 32px;border-radius:50%;}' +
      '#pgSombra .pgs-anillo i{position:absolute;inset:4px;border-radius:50%;background:#1B2D3A;display:flex;' +
        'align-items:center;justify-content:center;font:700 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;' +
        'color:#2DBFA3;font-style:normal;letter-spacing:-.02em;}' +
      '#pgSombra .pgs-foto{width:32px;height:32px;flex:0 0 32px;border-radius:50%;object-fit:cover;display:block;}' +
      '#pgSombra b{font:700 13px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:-.01em;}' +
      '#pgSombra .pgs-de{color:#9FB2BF;font-weight:600;}' +
      '#pgSombra .pgs-alerta{color:#F0C55A;font-weight:700;}' +
      '@keyframes pgsLate{0%{transform:scale(1)}35%{transform:scale(1.09)}100%{transform:scale(1)}}' +
      '#pgSombra.pgs-late{animation:pgsLate .9s ease 1;}' +
      '@media (max-width:640px){#pgSombra{right:12px;bottom:12px;padding:6px 12px 6px 6px;}' +
        '#pgSombra .pgs-texto{display:none;}}' +
      '@media print{#pgSombra{display:none!important;}}';
    document.head.appendChild(st);
  }

  function pintar(d, cli) {
    if (document.getElementById('pgSombra')) return;
    estilos();

    var pct  = Math.max(0, Math.min(100, Number(d.pct) || 0));
    var real = Number(d.pct) || 0;
    var b = document.createElement('button');
    b.id = 'pgSombra';
    b.type = 'button';
    b.title = 'Mi proceso · ' + esc(d.nombre);
    b.setAttribute('aria-label', 'Mi proceso: llevas ' + usd(d.mc) + ' de ' + usd(d.meta));

    var anillo = '<span class="pgs-anillo" style="background:conic-gradient(#2DBFA3 0 ' + pct + '%,#35566A ' + pct + '% 100%)">'
               + '<i>' + (real > 999 ? '999' : real) + '</i></span>';
    var foto = d.foto
      ? '<img class="pgs-foto" src="' + esc(d.foto) + '" alt="" onerror="this.remove()">'
      : '';

    var aviso = (d.diasSin !== null && d.diasSin !== undefined && Number(d.diasSin) >= 3)
      ? ' <span class="pgs-alerta">· ' + Number(d.diasSin) + ' d sin cotizar</span>' : '';

    b.innerHTML = foto + anillo
      + '<span class="pgs-texto"><b>' + usd(d.mc) + '</b> <span class="pgs-de">de ' + usd(d.meta) + '</span>' + aviso + '</span>';

    b.addEventListener('click', function () {
      try {
        cli.schema('portal').from('aperturas')
           .insert({ clave: 'gabi_asesor', origen: 'sombra' }).then(function () {}, function () {});
      } catch (e) { /* la medición nunca puede estorbar el clic */ }
      global.location.href = DESTINO;
    });

    document.body.appendChild(b);
    requestAnimationFrame(function () { b.classList.add('pgs-in'); });

    var antes = anterior();
    if (antes !== null && Number(d.mc) > antes) {
      setTimeout(function () { b.classList.add('pgs-late'); }, 500);
    }
    recordar(Number(d.mc) || 0);
  }

  function cliente() {
    if (!(global.supabase && global.supabase.createClient)) return null;
    try { return global.supabase.createClient(URL_SB, KEY_SB); } catch (e) { return null; }
  }

  function arrancar() {
    // En modo "ver como" la sombra no aplica: mostraría las cifras de quien
    // mira, no las de la persona simulada, y eso confunde más de lo que ayuda.
    try {
      if (new URLSearchParams(global.location.search).get('ver_como')) return;
    } catch (e) {}
    // La página ya la pintó (dos scripts, una sola sombra)
    if (global.__pgSombraLista) return;
    global.__pgSombraLista = true;

    var cli = cliente();
    if (!cli) return;

    var cache = guardado();
    if (cache && cache.d) { pintar(cache.d, cli); return; }

    cli.auth.getSession().then(function (r) {
      if (!(r && r.data && r.data.session)) return;
      cli.rpc('mi_sombra').then(function (res) {
        if (!res || res.error || !res.data) return;   // no es asesor, o no resolvió: sin sombra
        guardar(res.data);
        pintar(res.data, cli);
      }, function () {});
    }, function () {});
  }

  function esperar() {
    if (global.supabase && global.supabase.createClient) { arrancar(); return; }
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    s.onload = arrancar;
    document.head.appendChild(s);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(esperar, 900); });
  } else {
    setTimeout(esperar, 900);
  }
})(window);
