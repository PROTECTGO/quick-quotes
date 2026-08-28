/* ============================================================
   GABI · ver-como-helper.js — banner de "viendo como" para el parámetro
   ?ver_como=email de la URL. SIMULACIÓN DE VISTA, no impersonación:
   nunca cambia de sesión, nunca toca auth.uid().

   El parámetro SOLO hace algo si la sesión real (auth.uid() de quien
   abrió el link) tiene una fila activa en gabi_accesos con rol
   'director' o 'socio' — verificado contra la base de datos con una
   consulta a su PROPIA fila (RLS lee_su_acceso, sin necesitar permiso
   nuevo), nunca contra nada elegible desde la UI. Para cualquier otra
   sesión, el parámetro se ignora en silencio: no banner, no efecto.

   LÍMITE HONESTO (documentado en Vista Maestra de Control Maestro):
   este helper solo verifica el rol real y pinta el banner fijo. NO
   vuelve a filtrar los datos que la pantalla ya carga por su cuenta —
   esos siguen llegando con el RLS de la sesión real. Para la mayoría de
   pantallas eso significa "simulación parcial": ves el mismo diseño y
   layout que vería la persona simulada, pero las cifras que aparecen
   son las que el RLS le da a quien de verdad abrió el link, no
   necesariamente las de esa persona.

   Uso en cada pantalla, después de tener sesión confirmada:
     const verComo = await gabiVerComoInit(SB);
     if (verComo) { ... opcional: usar verComo.email para lo que la
       pantalla pueda re-filtrar por su cuenta ... }
   ============================================================ */
(function (global) {
  'use strict';

  function qs(name) {
    try { return new URLSearchParams(window.location.search).get(name); }
    catch (e) { return null; }
  }

  function escBanner(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function pintarBanner(emailSimulado) {
    if (document.getElementById('gabiVerComoBanner')) return;
    var b = document.createElement('div');
    b.id = 'gabiVerComoBanner';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99998;background:#1B2D3A;color:#fff;' +
      'font:600 13px/1.4 Arial,Helvetica,sans-serif;padding:10px 16px;display:flex;align-items:center;' +
      'justify-content:center;gap:10px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.25)';
    b.innerHTML = '👁 Viendo como <b>' + escBanner(emailSimulado) + '</b> — simulación de solo lectura, esto no es su sesión real.';
    document.body.insertBefore(b, document.body.firstChild);
    var spacer = document.createElement('div');
    // se mide después de insertar, en el próximo frame, para no empujar el layout con un valor a ciegas
    requestAnimationFrame(function () { spacer.style.height = b.offsetHeight + 'px'; });
    document.body.insertBefore(spacer, document.body.firstChild);
  }

  /* Llamar una sola vez al arrancar, con el cliente Supabase ya creado
     y DESPUÉS de confirmar que hay sesión (SB.auth.getSession()).
     Devuelve {email} si el parámetro aplicó, o null si no (sin
     parámetro, sin sesión, o sesión real sin rol director/socio). */
  global.gabiVerComoInit = async function (SB) {
    var target = qs('ver_como');
    if (!target) return null;
    try {
      var ses = await SB.auth.getSession();
      var uid = ses && ses.data && ses.data.session ? ses.data.session.user.id : null;
      if (!uid) return null;
      // .schema('public') explícito: algunas pantallas pasan un cliente ya
      // configurado con otro esquema por defecto (p.ej. mapa-puestos.html
      // usa schema 'portal' para todo lo demás) — gabi_accesos vive en public.
      var r = await SB.schema('public').from('gabi_accesos').select('rol,activo,vigencia_desde').eq('user_id', uid).eq('activo', true);
      if (r.error || !r.data || !r.data.length) return null;
      var hoy = new Date().toISOString().slice(0, 10);
      var esDirSoc = r.data.some(function (row) {
        return (row.rol === 'director' || row.rol === 'socio') && String(row.vigencia_desde || '') <= hoy;
      });
      if (!esDirSoc) return null; // parámetro ignorado en silencio para cualquier otro rol
      pintarBanner(target);
      return { email: target };
    } catch (e) { return null; }
  };
})(window);
