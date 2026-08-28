/* ============================================================================
   GABI · asesor-oportunidad-shared.js — "Lo que dejas de ganar"
   Módulo compartido entre gabi-asesor.html (modo individual) y
   gabi-brahian.html (modo equipo, herramienta de coaching de Brahian).

   Tres piezas, en este orden:
     G1 — Lo que ganaste vs. lo que pudiste ganar (comisión, línea real +
          línea punteada + franja ámbar de oportunidad)
     G2 — Tu paquete por cliente (pólizas promedio por cliente + tabla ancla)
     G3 — Cuánto te falta para el siguiente escalón (medidor, no gráfica)

   REGLAS DE TONO (no negociables — ver ronda "LO QUE DEJAS DE GANAR"):
     - Oportunidad, nunca castigo: "queda por capturar", nunca "no cobraste".
     - La franja/serie de oportunidad va en ámbar (--pg-warn), NUNCA en rojo.
     - La banda de fee típico es estadística ("lo típico para este tipo de
       póliza"), nunca una tarifa ("lo que debiste cobrar").
     - Cero barras. Solo línea/área/medidor.
     - Modo individual: SIN ranking con nombres. Modo equipo: SÍ hay nombres
       (es la herramienta de coaching de Brahian), pero nunca cifras de
       nómina/costo — solo comisión de oportunidad (ya decidido por Andrés
       que ese número SÍ se muestra) y distancias de premium a escalón.

   Fuentes — todas ya legibles por RLS propio, sin funciones nuevas:
     v_venta_vs_banda        -> fee_real vs fee_tipico por venta (fees)
     v_ventas_por_cliente    -> pólizas por cliente cerrado (paquete)
     v_liquidacion_incentivos-> premium, fees, escalón, comisión ya calculada
     reglas_comision         -> cortes de escalón por premium (RLS: self)

   Todas las consultas usan paginación real (.range) con .order() estable —
   ninguna se corta en el tope de 1.000 filas de PostgREST sin avisar.
   ============================================================================ */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------- utils */
  const esc = (s) => (s == null ? '' : String(s)).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const fmtUSD0 = (n) => (n == null || isNaN(n)) ? '—' : '$' + Math.round(Number(n)).toLocaleString('en-US');
  const fmtUSD = (n) => (n == null || isNaN(n)) ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPct = (n, d = 0) => (n == null || isNaN(n)) ? '—' : Number(n).toFixed(d) + '%';
  const MESES_ES_ABR = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const ymOf = (d) => String(d).slice(0, 7);
  function fmtMesCorto(ym) { const [y, m] = String(ym).split('-').map(Number); return MESES_ES_ABR[(m||1) - 1] + '-' + y; }

  /* -------------------------------------------------- paginación segura --
     El default de PostgREST corta en 1.000 filas SIN error. .range() con
     .order() estable evita el bug (visto y arreglado ya en otras pantallas
     esta ronda de trabajo). Aquí los volúmenes por alcance (un asesor o el
     equipo de un líder, año en curso) están verificados muy por debajo de
     1.000, pero se pagina siempre para no repetir el error si crece. */
  async function qAll(SB, view, cols, build, pageSize = 1000) {
    let out = [], from = 0;
    for (;;) {
      let q = SB.from(view).select(cols).range(from, from + pageSize - 1);
      if (build) q = build(q);
      const { data, error } = await q;
      if (error) throw error;
      out = out.concat(data || []);
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }
    return out;
  }

  /* --------------------------------------------------------------- fetch */
  async function fetchBanda(SB, nombres, anio) {
    return qAll(SB, 'v_venta_vs_banda', 'seller,fecha_mes,fee_real,fee_tipico,vs_banda',
      (q) => q.in('seller', nombres).gte('fecha_mes', anio + '-01-01').order('fecha_mes', { ascending: true }).order('seller', { ascending: true }));
  }
  async function fetchPaquetes(SB, nombres, anio) {
    return qAll(SB, 'v_ventas_por_cliente', 'seller,cliente_key,fecha_mes,polizas',
      (q) => q.in('seller', nombres).gte('fecha_mes', anio + '-01-01').order('fecha_mes', { ascending: true }).order('cliente_key', { ascending: true }));
  }
  async function fetchLiquidacion(SB, nombres, anio) {
    return qAll(SB, 'v_liquidacion_incentivos', 'agente,mes,premium_neto,fees_cobrados,escalon_premium,pct_escala_efectivo,pago_estimado_usd',
      (q) => q.in('agente', nombres).gte('mes', anio + '-01-01').order('mes', { ascending: true }).order('agente', { ascending: true }));
  }
  async function fetchReglas(SB) {
    // RLS (agente_can_read_reglas_unidad) ya deja pasar solo la fila de la
    // propia unidad de quien está logueado — no hace falta filtrar a mano.
    const { data, error } = await SB.from('reglas_comision')
      .select('premium_min_15,premium_min_30,premium_min_35,premium_min_40').limit(5);
    if (error) throw error;
    return (data && data[0]) || { premium_min_15: 25000, premium_min_30: 35000, premium_min_35: 85000, premium_min_40: 100000 };
  }

  /* ---------------------------------------------------------- constantes
     Tabla-ancla verificada por Andrés en Supabase (paquete por cliente,
     año en curso). Es una referencia de agencia, no cambia por asesor. */
  const REF_PAQUETE = [
    { pol: 1, premium: 10456, clientes: 175 },
    { pol: 2, premium: 14898, clientes: 108 },
    { pol: 3, premium: 24102, clientes: 62 },
    { pol: 4, premium: 37703, clientes: 22 },
    { pol: 5, premium: 50772, clientes: 8 },
  ];
  // "Paquete completo" = 3 coberturas (GL + Liability + Cargo, como ya se
  // describe en el resto de la pantalla). Valor marginal 1→3 pólizas.
  const MARGINAL_PAQUETE = REF_PAQUETE[2].premium - REF_PAQUETE[0].premium;

  function tiersFromReglas(reglas) {
    return [
      { cut: Number(reglas.premium_min_15 || 25000), pct: 15 },
      { cut: Number(reglas.premium_min_30 || 35000), pct: 30 },
      { cut: Number(reglas.premium_min_35 || 85000), pct: 35 },
      { cut: Number(reglas.premium_min_40 || 100000), pct: 40 },
    ];
  }

  /* ------------------------------------------------------------ agregados */
  function gapDe(r) { return Math.max(0, Number(r.fee_tipico || 0) - Number(r.fee_real || 0)); }

  function aggBandaPorAgenteMes(rows) {
    const m = {};
    rows.forEach((r) => {
      const ym = ymOf(r.fecha_mes), key = r.seller + '|' + ym;
      if (!m[key]) m[key] = { agente: r.seller, ym, ventas: 0, sinFee: 0, brechaFee: 0 };
      m[key].ventas++;
      m[key].brechaFee += gapDe(r);
      if (r.vs_banda === 'sin_fee') m[key].sinFee++;
    });
    return Object.values(m);
  }

  function liqPorAgente(liqRows) {
    const m = {};
    liqRows.forEach((r) => { (m[r.agente] || (m[r.agente] = [])).push(r); });
    return m;
  }
  function pctEscalaVigente(liqByAgente, agente, ym) {
    const rows = liqByAgente[agente] || [];
    const exacto = rows.find((r) => ymOf(r.mes) === ym && r.pct_escala_efectivo != null);
    if (exacto) return Number(exacto.pct_escala_efectivo);
    const antes = rows.filter((r) => ymOf(r.mes) <= ym && r.pct_escala_efectivo != null).sort((a, b) => (a.mes < b.mes ? 1 : -1))[0];
    if (antes) return Number(antes.pct_escala_efectivo);
    const cualquiera = rows.find((r) => r.pct_escala_efectivo != null);
    return cualquiera ? Number(cualquiera.pct_escala_efectivo) : 20;
  }

  function comisionDeFila(r) {
    const premium = Number(r.premium_neto || 0), fees = Number(r.fees_cobrados || 0);
    const escalonPct = Number(r.escalon_premium || 0), escalaPct = Number(r.pct_escala_efectivo || 0);
    return r.pago_estimado_usd != null ? Number(r.pago_estimado_usd) : (premium * escalonPct / 100 + fees * escalaPct / 100);
  }

  function armarG1(bandaRows, liqRows) {
    const liqByAgente = liqPorAgente(liqRows);
    const porAgenteMes = aggBandaPorAgenteMes(bandaRows);

    const realPorMes = {};
    liqRows.forEach((r) => { const ym = ymOf(r.mes); realPorMes[ym] = (realPorMes[ym] || 0) + comisionDeFila(r); });

    const brechaPorMes = {};
    const porAgente = {};
    porAgenteMes.forEach((g) => {
      const pct = pctEscalaVigente(liqByAgente, g.agente, g.ym);
      const brechaCom = g.brechaFee * pct / 100;
      brechaPorMes[g.ym] = (brechaPorMes[g.ym] || 0) + brechaCom;
      if (!porAgente[g.agente]) porAgente[g.agente] = { agente: g.agente, ventas: 0, sinFee: 0, brechaFee: 0, brechaComision: 0 };
      porAgente[g.agente].ventas += g.ventas;
      porAgente[g.agente].sinFee += g.sinFee;
      porAgente[g.agente].brechaFee += g.brechaFee;
      porAgente[g.agente].brechaComision += brechaCom;
    });

    const meses = Array.from(new Set([...Object.keys(realPorMes), ...Object.keys(brechaPorMes)])).sort();
    const real = meses.map((ym) => realPorMes[ym] || 0);
    const brecha = meses.map((ym) => brechaPorMes[ym] || 0);
    const potencial = meses.map((ym, i) => real[i] + brecha[i]);

    const totalBrechaComision = brecha.reduce((a, b) => a + b, 0);
    const totalBrechaFee = porAgenteMes.reduce((s, g) => s + g.brechaFee, 0);
    const totalBrechaFeeSinFee = bandaRows.filter((r) => r.vs_banda === 'sin_fee').reduce((s, r) => s + gapDe(r), 0);
    const nSinFee = bandaRows.filter((r) => r.vs_banda === 'sin_fee').length;
    const factorConv = totalBrechaFee > 0 ? totalBrechaComision / totalBrechaFee : 0;
    const brechaComisionSinFee = totalBrechaFeeSinFee * factorConv;
    const shareSinFee = totalBrechaComision > 0 ? (brechaComisionSinFee / totalBrechaComision) : 0;

    return { meses, real, potencial, totalBrechaComision, nSinFee, brechaComisionSinFee, shareSinFee, porAgente: Object.values(porAgente) };
  }

  function armarG2(rows) {
    const porMes = {};
    rows.forEach((r) => {
      const ym = ymOf(r.fecha_mes);
      if (!porMes[ym]) porMes[ym] = { ym, clientes: 0, polizas: 0 };
      porMes[ym].clientes++;
      porMes[ym].polizas += Number(r.polizas || 0);
    });
    const meses = Object.keys(porMes).sort();
    const promedio = meses.map((ym) => porMes[ym].clientes ? (porMes[ym].polizas / porMes[ym].clientes) : 0);
    const con1 = rows.filter((r) => Number(r.polizas || 0) === 1).length;

    const porAgente = {};
    rows.forEach((r) => {
      if (!porAgente[r.seller]) porAgente[r.seller] = { agente: r.seller, clientes: 0, con1: 0 };
      porAgente[r.seller].clientes++;
      if (Number(r.polizas || 0) === 1) porAgente[r.seller].con1++;
    });

    return { meses, promedio, con1, porAgente: Object.values(porAgente) };
  }

  function proximoEscalon(premium, tiers) {
    return tiers.find((t) => premium < t.cut) || null;
  }

  function armarG3(liqRows, bandaRows, tiers, modoEquipo) {
    const hoy = new Date();
    const ymActual = hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0');

    if (!modoEquipo) {
      const rows = liqRows.slice().sort((a, b) => (a.mes < b.mes ? 1 : -1));
      const mesRow = rows.find((r) => ymOf(r.mes) === ymActual) || rows[0] || null;
      if (!mesRow) return null;
      const premium = Number(mesRow.premium_neto || 0);
      const next = proximoEscalon(premium, tiers);
      const gaps = bandaRows.filter((r) => ymOf(r.fecha_mes) === ymOf(mesRow.mes)).map(gapDe).filter((g) => g > 0);
      const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
      return { individual: true, mes: mesRow.mes, premium, next, avgGap };
    }

    // Modo equipo: última fila conocida por agente (preferimos el mes en
    // curso; si un agente aún no tiene fila este mes, usamos su más reciente).
    const porAgente = {};
    liqRows.forEach((r) => {
      const cur = porAgente[r.agente];
      if (!cur || ymOf(r.mes) === ymActual || (cur.mes < r.mes && ymOf(cur.mes) !== ymActual)) porAgente[r.agente] = r;
    });
    const lista = Object.values(porAgente).map((r) => {
      const premium = Number(r.premium_neto || 0);
      const next = proximoEscalon(premium, tiers);
      return { agente: r.agente, mes: r.mes, premium, next, falta: next ? next.cut - premium : null };
    }).filter((x) => x.next != null).sort((a, b) => a.falta - b.falta);
    return { individual: false, lista };
  }

  /* ------------------------------------------------------------------ CSS */
  function injectCSS() {
    if (document.getElementById('opo-css')) return;
    const css = `
.opo-card{background:var(--pg-card,#fff);border:1px solid var(--pg-line,#E7EDF2);border-radius:18px;padding:22px;margin-bottom:20px;box-shadow:0 1px 3px rgba(27,45,58,.04);}
.opo-card h2{font-family:var(--pg-font-title,inherit);font-size:17.5px;font-weight:800;color:var(--pg-ink,#1B2D3A);margin:0 0 4px;}
.opo-purpose{color:var(--pg-muted,#6B7D89);font-size:13px;margin:0 0 14px;line-height:1.5;}
.opo-headline{font-family:var(--pg-font-title,inherit);font-size:16px;font-weight:800;color:var(--pg-ink,#1B2D3A);margin:0 0 4px;line-height:1.35;}
.opo-headline b{color:var(--pg-warn,#D9A520);}
.opo-sub{color:var(--pg-muted,#6B7D89);font-size:12.5px;margin:6px 0 14px;}
.opo-chart{position:relative;height:250px;margin-bottom:10px;}
.opo-kpis{display:flex;gap:14px;flex-wrap:wrap;margin:12px 0;}
.opo-kpi{flex:1;min-width:150px;border:1px solid var(--pg-line,#E7EDF2);border-radius:12px;padding:12px 14px;}
.opo-kpi .l{font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--pg-muted,#6B7D89);}
.opo-kpi .v{font-family:"JetBrains Mono",monospace;font-size:20px;font-weight:700;color:var(--pg-ink,#1B2D3A);margin:5px 0 2px;}
.opo-kpi .v.warn{color:var(--pg-warn,#D9A520);}
.opo-table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:6px;}
.opo-table th{text-align:right;font-size:10.5px;color:var(--pg-muted,#6B7D89);text-transform:uppercase;letter-spacing:.04em;padding:7px 8px;border-bottom:2px solid var(--pg-ink,#1B2D3A);font-weight:700;}
.opo-table th:first-child,.opo-table td:first-child{text-align:left;}
.opo-table td{text-align:right;padding:8px;border-bottom:1px solid var(--pg-line,#E7EDF2);font-family:"JetBrains Mono",monospace;}
.opo-table tr.on td{background:#FBF3E2;font-weight:700;}
.opo-meter-track{background:#EEF2F5;border-radius:999px;height:14px;overflow:hidden;margin:10px 0 8px;}
.opo-meter-fill{height:100%;background:var(--pg-warn,#D9A520);border-radius:999px;transition:width .3s;}
.opo-meter-labels{display:flex;justify-content:space-between;font-size:11.5px;color:var(--pg-muted,#6B7D89);font-family:"JetBrains Mono",monospace;}
.opo-rank{display:flex;justify-content:space-between;align-items:center;padding:9px 4px;border-bottom:1px solid var(--pg-line,#E7EDF2);gap:10px;}
.opo-rank:last-child{border-bottom:none;}
.opo-rank .n{font-weight:700;color:var(--pg-ink,#1B2D3A);font-size:13px;}
.opo-rank .b{font-family:"JetBrains Mono",monospace;font-size:11.5px;color:var(--pg-warn,#D9A520);font-weight:700;text-align:right;white-space:nowrap;}
.opo-note{background:#F1FAF7;border:1px solid #CDEBE2;border-left:3px solid var(--pg-mint,#2DBFA3);border-radius:8px;padding:10px 12px;color:#28323B;font-size:12px;line-height:1.5;margin-top:10px;}
.opo-empty,.opo-loading{color:var(--pg-muted,#6B7D89);font-size:13px;padding:14px 0;}
.opo-warn{background:#FBF3E2;border:1px solid #EAD09A;border-radius:12px;padding:13px 17px;color:#8a6a1d;font-size:13px;}
`;
    const s = document.createElement('style'); s.id = 'opo-css'; s.textContent = css; document.head.appendChild(s);
  }

  /* -------------------------------------------------------------- render */
  let CH1 = null, CH2 = null;

  function htmlG1(g1, modoEquipo, tituloSufijo) {
    const sinDatos = !g1.meses.length;
    const frasePrincipal = sinDatos
      ? 'Aún no hay suficientes ventas este año para calcular esto.'
      : `En ${new Date().getFullYear()} queda por capturar <b>${fmtUSD0(g1.totalBrechaComision)}</b> en comisión` +
        (g1.nSinFee > 0
          ? ` — ${g1.shareSinFee >= 0.55 ? 'casi todo' : 'gran parte'} en las <b>${g1.nSinFee}</b> venta(s) donde no se cobró fee de agencia (~${fmtUSD0(g1.brechaComisionSinFee)}).`
          : '.');
    let ranking = '';
    if (modoEquipo && g1.porAgente.length) {
      const top = g1.porAgente.slice().sort((a, b) => b.brechaComision - a.brechaComision).slice(0, 8);
      ranking = `
        <div class="opo-sub" style="margin-top:16px;font-weight:700;color:var(--pg-ink,#1B2D3A);">Dónde hay más oportunidad por capturar — ${esc(tituloSufijo)}</div>
        ${top.map((a) => `<div class="opo-rank"><span class="n">${esc(a.agente)}</span><span class="b">${fmtUSD0(a.brechaComision)} · ${a.sinFee} venta(s) sin fee</span></div>`).join('')}
        <div class="opo-note">Quien más aparece aquí suele ser quien más vende — no es una lista de bajo desempeño, es dónde hay más plata por capturar. Karen, Dayanna y otros líderes de volumen suelen encabezarla justo por eso.</div>`;
    }
    return `
      <div class="opo-card">
        <h2>Lo que ganaste vs. lo que pudiste ganar</h2>
        <p class="opo-purpose">Línea verde: tu comisión real, mes a mes${modoEquipo ? ' (equipo)' : ''}. Línea punteada: lo que habrías ganado cobrando el fee típico para cada tipo de póliza. La franja ámbar es lo que queda por capturar — no es un descuento, es oportunidad sobre la mesa.</p>
        ${sinDatos ? '<div class="opo-empty">Aún no hay ventas suficientes este año para esta gráfica.</div>' : '<div class="opo-chart"><canvas id="opoChG1"></canvas></div>'}
        <p class="opo-headline">${frasePrincipal}</p>
        ${ranking}
      </div>`;
  }

  function htmlG2(g2, modoEquipo, tituloSufijo) {
    const sinDatos = !g2.meses.length;
    let ranking = '';
    if (modoEquipo && g2.porAgente.length) {
      const top = g2.porAgente.filter((a) => a.con1 > 0).sort((a, b) => b.con1 - a.con1).slice(0, 8);
      if (top.length) ranking = `
        <div class="opo-sub" style="margin-top:16px;font-weight:700;color:var(--pg-ink,#1B2D3A);">Clientes con una sola póliza por armar el paquete — ${esc(tituloSufijo)}</div>
        ${top.map((a) => `<div class="opo-rank"><span class="n">${esc(a.agente)}</span><span class="b">${a.con1} de ${a.clientes} cliente(s)</span></div>`).join('')}`;
    }
    return `
      <div class="opo-card">
        <h2>Tu paquete por cliente</h2>
        <p class="opo-purpose">Pólizas promedio por cliente cerrado, mes a mes. La línea punteada en 2.0 es la meta de referencia: un cliente con paquete completo vale mucho más que uno con una sola póliza suelta.</p>
        ${sinDatos ? '<div class="opo-empty">Aún no hay clientes cerrados este año para esta gráfica.</div>' : '<div class="opo-chart"><canvas id="opoChG2"></canvas></div>'}
        ${g2.con1 > 0 ? `<p class="opo-headline">Tienes <b>${g2.con1}</b> cliente(s) con una sola póliza — ahí es donde está el paquete por armar.</p>` : ''}
        <table class="opo-table"><thead><tr><th>Pólizas del paquete</th><th>Premium promedio · cliente</th><th>Clientes (agencia, este año)</th></tr></thead>
        <tbody>${REF_PAQUETE.map((r) => `<tr><td>${r.pol}</td><td>${fmtUSD0(r.premium)}</td><td>${r.clientes}</td></tr>`).join('')}</tbody></table>
        <p class="opo-sub">Un cliente con 3 pólizas (paquete completo) vale ${(REF_PAQUETE[2].premium / REF_PAQUETE[0].premium).toFixed(1)}x lo que uno con 1 sola.</p>
        ${ranking}
      </div>`;
  }

  function htmlG3(g3, tiers) {
    if (!g3) return `<div class="opo-card"><h2>Cuánto te falta para el siguiente escalón</h2><div class="opo-empty">Aún no hay premium calculado este mes para esta pieza.</div></div>`;

    if (g3.individual) {
      if (!g3.next) {
        return `<div class="opo-card"><h2>Cuánto te falta para el siguiente escalón</h2>
          <p class="opo-purpose">Tu comisión sobre premium sube por escalones — ${tiers.map((t) => t.pct + '%').join(' · ')} — según cuánto premium vendas en el mes.</p>
          <p class="opo-headline">Ya estás en tu escalón más alto (<b>${tiers[tiers.length - 1].pct}%</b>) este mes — todo el premium que sumes de aquí en adelante ya está en tu mejor tramo.</p></div>`;
      }
      const falta = g3.next.cut - g3.premium;
      const pctAvance = Math.max(0, Math.min(100, (g3.premium / g3.next.cut) * 100));
      const clientesEquiv = Math.max(1, Math.ceil(falta / MARGINAL_PAQUETE));
      const ventasFeeEquiv = g3.avgGap ? Math.max(1, Math.ceil(falta / g3.avgGap)) : null;
      return `<div class="opo-card">
        <h2>Cuánto te falta para el siguiente escalón</h2>
        <p class="opo-purpose">Tu comisión sobre premium sube por escalones — ${tiers.map((t) => t.pct + '%').join(' · ')} — según cuánto premium vendas en el mes (${fmtMesCorto(ymOf(g3.mes))}).</p>
        <div class="opo-meter-track"><div class="opo-meter-fill" style="width:${pctAvance}%"></div></div>
        <div class="opo-meter-labels"><span>${fmtUSD0(g3.premium)}</span><span>${fmtUSD0(g3.next.cut)} → ${g3.next.pct}%</span></div>
        <p class="opo-headline">Estás a <b>${fmtUSD0(falta)}</b> del ${g3.next.pct}%. Eso es ~${clientesEquiv} cliente(s) con paquete completo${ventasFeeEquiv ? `, o cobrar el fee típico en tus últimas ~${ventasFeeEquiv} venta(s)` : ''}.</p>
        <p class="opo-sub">El escalón se calcula sobre premium. Las equivalencias de clientes/ventas son para visualizar la distancia en dólares, no un segundo camino técnico al mismo escalón.</p>
      </div>`;
    }

    // Modo equipo: ranked list, sin cifras de nómina — solo distancia de premium.
    const cerca = g3.lista.filter((x) => x.falta <= 10000).length;
    return `<div class="opo-card">
      <h2>Cuánto le falta a cada quien para el siguiente escalón</h2>
      <p class="opo-purpose">Comisión sobre premium por escalones — ${tiers.map((t) => t.pct + '%').join(' · ')}. Aquí solo se ve la distancia de premium al siguiente corte, no cifras de nómina.</p>
      ${g3.lista.length ? `<p class="opo-headline"><b>${cerca}</b> asesor(es) están a un empujón (≤$10,000) de subir de escalón este mes.</p>` : '<div class="opo-empty">Nadie del equipo tiene premium calculado este mes todavía.</div>'}
      ${g3.lista.slice(0, 10).map((x) => `<div class="opo-rank"><span class="n">${esc(x.agente)}</span><span class="b">${fmtUSD0(x.falta)} para el ${x.next.pct}%</span></div>`).join('')}
    </div>`;
  }

  function dibujarG1(g1) {
    if (CH1) { try { CH1.destroy(); } catch (e) {} }
    if (!g1.meses.length) return;
    const canvas = document.getElementById('opoChG1');
    if (!canvas || !global.Chart) return;
    CH1 = new global.Chart(canvas, {
      data: {
        labels: g1.meses.map(fmtMesCorto),
        datasets: [
          { type: 'line', label: 'Tu comisión real', data: g1.real, borderColor: '#1F9D6B', backgroundColor: 'transparent', borderWidth: 2.6, tension: .3, pointRadius: 3, pointBackgroundColor: '#1F9D6B', order: 2, fill: false },
          { type: 'line', label: 'Lo que pudiste ganar (fee típico)', data: g1.potencial, borderColor: '#D9A520', borderDash: [5, 4], borderWidth: 1.8, tension: .3, pointRadius: 0, order: 1, fill: '-1', backgroundColor: 'rgba(217,165,32,.20)' },
        ],
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, font: { size: 11.5 } } },
          tooltip: { callbacks: { label: (it) => it.dataset.label + ': ' + fmtUSD0(it.parsed.y) } },
        },
        scales: {
          y: { beginAtZero: true, ticks: { callback: (v) => '$' + Number(v).toLocaleString('en-US') } },
          x: { grid: { display: false } },
        },
      },
    });
  }

  function dibujarG2(g2) {
    if (CH2) { try { CH2.destroy(); } catch (e) {} }
    if (!g2.meses.length) return;
    const canvas = document.getElementById('opoChG2');
    if (!canvas || !global.Chart) return;
    CH2 = new global.Chart(canvas, {
      data: {
        labels: g2.meses.map(fmtMesCorto),
        datasets: [
          { type: 'line', label: 'Pólizas promedio por cliente', data: g2.promedio, borderColor: '#2DBFA3', backgroundColor: 'rgba(45,191,163,.14)', borderWidth: 2.4, tension: .3, pointRadius: 3, fill: true },
          { type: 'line', label: 'Meta de referencia (2.0)', data: g2.meses.map(() => 2), borderColor: '#9AA9B4', borderDash: [4, 4], borderWidth: 1.4, pointRadius: 0, fill: false },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, font: { size: 11.5 } } },
          tooltip: { callbacks: { label: (it) => it.dataset.label + ': ' + Number(it.parsed.y).toFixed(2) } },
        },
        scales: { y: { beginAtZero: true, suggestedMax: 3 }, x: { grid: { display: false } } },
      },
    });
  }

  async function render(mount, SB, opts) {
    opts = opts || {};
    const nombres = (opts.nombres || []).filter(Boolean);
    const modoEquipo = !!opts.modoEquipo;
    const tituloSufijo = opts.tituloSufijo || '';
    injectCSS();
    mount.innerHTML = '<div class="opo-loading">Cargando datos en vivo de Supabase…</div>';
    if (!nombres.length) { mount.innerHTML = '<div class="opo-empty">Sin nombres en el alcance.</div>'; return; }

    const anio = new Date().getFullYear();
    let banda, paquetes, liq, reglas;
    try {
      [banda, paquetes, liq, reglas] = await Promise.all([
        fetchBanda(SB, nombres, anio),
        fetchPaquetes(SB, nombres, anio),
        fetchLiquidacion(SB, nombres, anio),
        fetchReglas(SB),
      ]);
    } catch (e) {
      mount.innerHTML = `<div class="opo-warn">No pudimos cargar "Lo que dejas de ganar" ahora mismo. ${esc(e.message || '')}</div>`;
      return;
    }

    const tiers = tiersFromReglas(reglas);
    const g1 = armarG1(banda, liq);
    const g2 = armarG2(paquetes);
    const g3 = armarG3(liq, banda, tiers, modoEquipo);

    mount.innerHTML = htmlG1(g1, modoEquipo, tituloSufijo) + htmlG2(g2, modoEquipo, tituloSufijo) + htmlG3(g3, tiers);
    dibujarG1(g1);
    dibujarG2(g2);
  }

  global.GabiOportunidad = { render };
})(window);
