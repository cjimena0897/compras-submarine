'use strict';
/* Mis Pedidos — app personal. Los datos viven en este dispositivo (localStorage)
   y, si se configura, se respaldan en un repositorio privado de GitHub. */

const LS = 'pedidos-usa:v1', LSG = 'pedidos-usa:gh';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const hoy = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const num = v => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; };
const f2 = n => (Math.abs(n) < 0.005 ? 0 : n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const S = n => 'S/ ' + f2(n);
const D = n => '$ ' + f2(n);
const fechaCorta = f => { if (!f) return ''; const [y, m, d] = f.split('-'); return `${+d} ${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][m - 1]}`; };

/* ---------- Datos ---------- */
const base = () => ({
  version: 1, updatedAt: null,
  settings: { tc: 3.5, tax: 7.75, socio: 'Joaquín', metodos: ['Yape', 'Plin', 'Efectivo', 'Transferencia', 'Zelle', 'Otro'] },
  items: [], devoluciones: []
});

function normalizar(d) {
  if (!d || !Array.isArray(d.items)) throw new Error('El archivo no tiene el formato de esta app.');
  const b = base();
  const mon = m => (m === '$' ? '$' : 'S/');
  const pago = p => ({ id: p.id || uid(), fecha: p.fecha || '', monto: num(p.monto) || 0, moneda: mon(p.moneda), metodo: String(p.metodo || ''), nota: String(p.nota || '') });
  return {
    version: 1, updatedAt: d.updatedAt || new Date().toISOString(),
    settings: {
      tc: num(d.settings?.tc) || b.settings.tc, tax: num(d.settings?.tax) ?? b.settings.tax,
      socio: String(d.settings?.socio || b.settings.socio),
      metodos: Array.isArray(d.settings?.metodos) && d.settings.metodos.length ? d.settings.metodos.map(String) : b.settings.metodos
    },
    items: d.items.map(i => ({
      id: i.id || uid(), fecha: i.fecha || '', cliente: String(i.cliente || '').trim(), producto: String(i.producto || '').trim(),
      precioUSD: num(i.precioUSD), tax: num(i.tax) || 0, comPct: num(i.comPct) || 0, comFija: num(i.comFija),
      tc: num(i.tc) || b.settings.tc, venta: num(i.venta), monedaVenta: mon(i.monedaVenta),
      por: i.por === 'socio' ? 'socio' : 'yo', devolver: num(i.devolver), personal: !!i.personal,
      notas: String(i.notas || ''), pagos: (i.pagos || []).map(pago)
    })),
    devoluciones: (d.devoluciones || []).map(pago)
  };
}

let db = base();
try { const raw = localStorage.getItem(LS); if (raw) db = normalizar(JSON.parse(raw)); } catch (e) { console.error(e); }
let gh = {};
try { gh = JSON.parse(localStorage.getItem(LSG) || '{}'); } catch (e) { }

function guardar() {
  db.updatedAt = new Date().toISOString();
  try { localStorage.setItem(LS, JSON.stringify(db)); } catch (e) { toast('No se pudo guardar en el teléfono'); }
  programarSubida();
  render();
}

/* ---------- Cálculos ---------- */
function calc(it) {
  const tc = it.tc || db.settings.tc;
  const conTax = (it.precioUSD || 0) * (1 + (it.tax || 0) / 100);
  const com = it.comFija != null ? it.comFija : conTax * (it.comPct || 0) / 100;
  const costoUSD = conTax + com;
  const devUSD = it.por === 'socio' ? (it.devolver != null ? it.devolver : costoUSD) : 0;
  const costoS = (it.por === 'socio' ? devUSD : costoUSD) * tc;
  const tieneVenta = it.venta != null && it.venta > 0;
  const ventaS = tieneVenta ? (it.monedaVenta === '$' ? it.venta * tc : it.venta) : 0;
  const pagadoS = it.pagos.reduce((a, p) => a + (p.moneda === '$' ? p.monto * tc : p.monto), 0);
  const cliente = !!it.cliente && !it.personal;
  const saldoS = tieneVenta && cliente ? ventaS - pagadoS : 0;
  let estado;
  if (it.personal) estado = 'personal';
  else if (!tieneVenta) estado = 'sinprecio';
  else if (!it.cliente) estado = 'stock';
  else if (saldoS <= 0.005) estado = 'pagado';
  else estado = pagadoS > 0 ? 'parcial' : 'debe';
  return { tc, conTax, com, costoUSD, devUSD, costoS, tieneVenta, ventaS, pagadoS, saldoS, estado, ganS: tieneVenta ? ventaS - costoS : null, vendido: tieneVenta && cliente };
}
// Muestra un monto en soles en la moneda en que se vendió el pedido
const enMoneda = (it, c, s) => it.monedaVenta === '$' ? D(s / c.tc) : S(s);
const etiqueta = (it, c) => ({
  personal: 'Personal', sinprecio: 'Sin precio', stock: 'En venta', pagado: 'Pagado',
  parcial: 'Debe ' + enMoneda(it, c, c.saldoS), debe: 'Debe ' + enMoneda(it, c, c.saldoS)
}[c.estado]);

const clave = n => n.trim().toLowerCase();
function clientes() {
  const m = new Map();
  for (const it of db.items) {
    if (!it.cliente || it.personal) continue;
    const c = calc(it), k = clave(it.cliente);
    if (!m.has(k)) m.set(k, { nombre: it.cliente, items: [], ventaS: 0, pagadoS: 0, saldoS: 0 });
    const g = m.get(k);
    g.items.push(it); g.ventaS += c.ventaS; g.pagadoS += c.pagadoS; g.saldoS += c.saldoS;
  }
  return [...m.values()];
}
function totales() {
  const t = { vendido: 0, cobrado: 0, saldo: 0, costo: 0, gan: 0, personal: 0, nPersonal: 0, sinPrecio: 0, stock: 0, stockS: 0, metodos: {} };
  for (const it of db.items) {
    const c = calc(it);
    if (it.personal) { t.personal += c.costoS; t.nPersonal++; continue; }
    t.costo += c.costoS; t.cobrado += c.pagadoS;
    if (c.estado === 'sinprecio') t.sinPrecio++;
    if (c.estado === 'stock') { t.stock++; t.stockS += c.ventaS; }
    if (c.vendido) { t.vendido += c.ventaS; t.saldo += c.saldoS; t.gan += c.ganS; }
    for (const p of it.pagos) { const k = p.metodo || 'Sin registrar'; t.metodos[k] = (t.metodos[k] || 0) + (p.moneda === '$' ? p.monto * c.tc : p.monto); }
  }
  return t;
}
function socio() {
  const tc = db.settings.tc, r = { items: [], total: 0, vendido: 0, devuelto: 0 };
  for (const it of db.items) if (it.por === 'socio') {
    const c = calc(it); r.items.push(it); r.total += c.devUSD; if (c.vendido) r.vendido += c.devUSD;
  }
  r.devuelto = db.devoluciones.reduce((a, d) => a + (d.moneda === '$' ? d.monto : d.monto / tc), 0);
  r.debo = r.total - r.devuelto; r.deboVendido = r.vendido - r.devuelto; r.tc = tc;
  return r;
}

/* ---------- Vistas ---------- */
const ui = { tab: 'resumen', filtro: 'todos', q: '', cliente: null };
const porFecha = (a, b) => (b.fecha || '').localeCompare(a.fecha || '') || db.items.indexOf(b) - db.items.indexOf(a);

function filaItem(it, conCliente = true) {
  const c = calc(it);
  const sub = [conCliente ? (it.personal ? 'Uso personal' : it.cliente || 'Sin cliente') : null, fechaCorta(it.fecha)].filter(Boolean).join(' · ');
  return `<button class="row" data-act="verItem" data-id="${it.id}">
    <span class="l"><span class="t">${esc(it.producto)}</span><br><span class="s">${esc(sub)}${it.por === 'socio' ? ` · <span class="pill socio">${esc(db.settings.socio)}</span>` : ''}</span></span>
    <span class="r">${c.tieneVenta ? enMoneda(it, c, c.ventaS) : '<span class="s">' + D(it.por === 'socio' ? c.devUSD : c.costoUSD) + ' costo</span>'}<br><span class="pill ${c.estado}">${esc(etiqueta(it, c))}</span></span>
  </button>`;
}

function vResumen() {
  const t = totales(), cl = clientes().filter(c => c.saldoS > 0.005).sort((a, b) => b.saldoS - a.saldoS), so = socio();
  const met = Object.entries(t.metodos).sort((a, b) => b[1] - a[1]);
  if (!db.items.length) return cardCargar();
  return `
  <div class="card hero"><div class="lbl">Te falta cobrar</div><div class="big">${S(t.saldo)}</div>
    <div class="sub">${cl.length} ${cl.length === 1 ? 'persona te debe' : 'personas te deben'}</div></div>
  <div class="grid">
    <div class="stat"><div class="lbl">Vendido</div><div class="val">${S(t.vendido)}</div><div class="sub">lo que cobras en total</div></div>
    <div class="stat"><div class="lbl">Ya cobrado</div><div class="val">${S(t.cobrado)}</div><div class="sub">${t.vendido ? Math.round(t.cobrado / t.vendido * 100) : 0}% de lo vendido</div></div>
    <div class="stat"><div class="lbl">Costo</div><div class="val">${S(t.costo)}</div><div class="sub">producto + tax + comisión</div></div>
    <div class="stat"><div class="lbl">Ganancia</div><div class="val ${t.gan < 0 ? 'neg' : ''}">${S(t.gan)}</div><div class="sub">de lo vendido, si todos pagan</div></div>
  </div>
  ${so.items.length || db.devoluciones.length ? `<div class="card"><h2>${esc(db.settings.socio)}</h2>
    <button class="row" data-act="tab" data-tab="socio"><span class="l"><span class="t">Le debo</span><br><span class="s">de ${D(so.total)} que puso · devuelto ${D(so.devuelto)}</span></span>
    <span class="r"><b>${D(so.debo)}</b><br><span class="s">≈ ${S(so.debo * so.tc)}</span></span></button></div>` : ''}
  ${cl.length ? `<div class="card"><h2>Quién te debe</h2>${cl.slice(0, 6).map(c => `
    <button class="row" data-act="verCliente" data-c="${esc(c.nombre)}"><span class="l"><span class="t">${esc(c.nombre)}</span><br><span class="s">${c.items.length} ${c.items.length === 1 ? 'pedido' : 'pedidos'}</span></span>
    <span class="r neg"><b>${S(c.saldoS)}</b></span></button>`).join('')}
    ${cl.length > 6 ? `<button class="row" data-act="tab" data-tab="clientes"><span class="l s">Ver los ${cl.length}</span><span class="r">›</span></button>` : ''}</div>` : ''}
  ${met.length ? `<div class="card"><h2>Por dónde te pagaron</h2>${met.map(([k, v]) => `<div class="row"><span class="l">${esc(k)}</span><span class="r">${S(v)}</span></div>`).join('')}</div>` : ''}
  <div class="card"><h2>Otros</h2>
    <div class="row"><span class="l">Sin precio de venta</span><span class="r">${t.sinPrecio}</span></div>
    <div class="row"><span class="l">En venta, sin cliente</span><span class="r">${t.stock} · ${S(t.stockS)}</span></div>
    <div class="row"><span class="l">Uso personal (${t.nPersonal})</span><span class="r">${S(t.personal)}</span></div>
  </div>`;
}

const FILTROS = [['todos', 'Todos'], ['deben', 'Deben'], ['pagado', 'Pagados'], ['sinprecio', 'Sin precio'], ['stock', 'En venta'], ['personal', 'Personal']];
function vLista(por) {
  const q = clave(ui.q);
  const lista = db.items.filter(it => {
    if (it.por !== por) return false;
    const e = calc(it).estado;
    if (q && !clave(it.producto + ' ' + it.cliente).includes(q)) return false;
    switch (ui.filtro) {
      case 'deben': return e === 'debe' || e === 'parcial';
      case 'todos': return true;
      default: return e === ui.filtro;
    }
  }).sort(porFecha);
  return `<input class="buscar" id="q" placeholder="Buscar producto o cliente" value="${esc(ui.q)}" autocomplete="off">
  <div class="chips">${FILTROS.map(([k, l]) => `<button class="chip ${ui.filtro === k ? 'on' : ''}" data-act="filtro" data-f="${k}">${esc(l)}</button>`).join('')}</div>
  <div class="cuenta">${lista.length} ${lista.length === 1 ? 'pedido' : 'pedidos'}</div>
  ${lista.length ? `<div class="list">${lista.map(i => filaItem(i)).join('')}</div>` : '<div class="card vacio">Nada por aquí.</div>'}`;
}
function vMios() {
  if (!db.items.length) return cardCargar();
  const t = { n: 0, venta: 0, cobrado: 0, saldo: 0, costo: 0 };
  for (const it of db.items) if (it.por === 'yo' && !it.personal) {
    const c = calc(it); t.n++; t.costo += c.costoS; t.cobrado += c.pagadoS;
    if (c.vendido) { t.venta += c.ventaS; t.saldo += c.saldoS; }
  }
  return `<div class="grid">
    <div class="stat"><div class="lbl">Vendido</div><div class="val">${S(t.venta)}</div></div>
    <div class="stat"><div class="lbl">Te falta cobrar</div><div class="val ${t.saldo > 0.005 ? 'neg' : ''}">${S(t.saldo)}</div></div>
    <div class="stat"><div class="lbl">Ya cobrado</div><div class="val">${S(t.cobrado)}</div></div>
    <div class="stat"><div class="lbl">Costo</div><div class="val">${S(t.costo)}</div></div>
  </div>` + vLista('yo');
}
function cardCargar() {
  return `<div class="card"><h2>Cargar mis pedidos</h2>
    <p class="nota" style="margin-top:0">Escribe tu clave para traer tus pedidos del Excel y de Amazon a este teléfono. Solo hay que hacerlo una vez.</p>
    <input type="password" id="clave" autocomplete="off" autocapitalize="off" placeholder="Clave">
    <div class="acciones"><button class="btn pri" data-act="cargarCifrado">Cargar</button></div>
    <p class="nota">¿Prefieres empezar en blanco? Toca <b>+</b> para agregar un pedido.</p></div>`;
}

function vClientes() {
  if (ui.cliente) return vCliente();
  const cl = clientes().sort((a, b) => b.saldoS - a.saldoS || a.nombre.localeCompare(b.nombre));
  if (!cl.length) return '<div class="card vacio">Aún no hay clientes.</div>';
  return `<div class="list">${cl.map(c => `
    <button class="row" data-act="verCliente" data-c="${esc(c.nombre)}"><span class="l"><span class="t">${esc(c.nombre)}</span><br>
    <span class="s">${c.items.length} ${c.items.length === 1 ? 'pedido' : 'pedidos'} · total ${S(c.ventaS)}</span></span>
    <span class="r">${c.saldoS > 0.005 ? `<b class="neg">${S(c.saldoS)}</b><br><span class="s">debe</span>` : '<span class="pill pagado">Al día</span>'}</span></button>`).join('')}</div>`;
}
function vCliente() {
  const c = clientes().find(x => clave(x.nombre) === clave(ui.cliente));
  if (!c) { ui.cliente = null; return vClientes(); }
  const pagos = c.items.flatMap(it => it.pagos.map(p => ({ p, it }))).sort((a, b) => (b.p.fecha || '').localeCompare(a.p.fecha || ''));
  return `<button class="volver" data-act="verCliente" data-c="">‹ Clientes</button>
  <div class="card"><h2>${esc(c.nombre)}</h2>
    <div class="kv"><span>Total de sus pedidos</span><span>${S(c.ventaS)}</span></div>
    <div class="kv"><span>Ya pagó</span><span>${S(c.pagadoS)}</span></div>
    <div class="kv tot"><span>Le falta pagar</span><span class="${c.saldoS > 0.005 ? 'neg' : 'pos'}">${S(c.saldoS)}</span></div>
    ${c.saldoS > 0.005 ? `<div class="acciones"><button class="btn pri" data-act="pagoCliente" data-c="${esc(c.nombre)}">Registrar pago</button></div>` : ''}
  </div>
  <div class="list">${c.items.slice().sort(porFecha).map(i => filaItem(i, false)).join('')}</div>
  ${pagos.length ? `<div class="card"><h2>Pagos</h2>${pagos.map(({ p, it }) => `<div class="row"><span class="l"><span class="t">${esc(p.metodo || 'Sin registrar')}</span><br><span class="s">${esc([fechaCorta(p.fecha), it.producto].filter(Boolean).join(' · '))}</span></span><span class="r">${p.moneda === '$' ? D(p.monto) : S(p.monto)}</span></div>`).join('')}</div>` : ''}`;
}

function vSocio() {
  const so = socio(), n = esc(db.settings.socio);
  return `<div class="card hero"><div class="lbl">Le debo a ${n}</div><div class="big">${D(so.debo)}</div><div class="sub">≈ ${S(so.debo * so.tc)} al cambio ${so.tc}</div></div>
  <div class="card">
    <div class="kv"><span>Puso en total</span><span>${D(so.total)}</span></div>
    <div class="kv"><span>De eso, ya vendido</span><span>${D(so.vendido)}</span></div>
    <div class="kv"><span>Aún sin vender</span><span>${D(so.total - so.vendido)}</span></div>
    <div class="kv"><span>Ya le devolví</span><span>${D(so.devuelto)}</span></div>
    <div class="kv tot"><span>Le toca de lo ya vendido</span><span>${D(Math.max(0, so.deboVendido))}</span></div>
    <div class="acciones"><button class="btn" data-act="nuevoItem" data-por="socio">+ Compra de ${n}</button><button class="btn pri" data-act="nuevaDev">Registrar devolución</button></div>
  </div>
  ${so.items.length ? vLista('socio') : `<div class="card vacio">Aquí aparecen las cosas que compró ${n}.<br>Agrégalas con el botón de arriba.</div>`}
  ${db.devoluciones.length ? `<div class="card"><h2>Devoluciones</h2>${db.devoluciones.slice().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).map(d => `
    <div class="row"><span class="l"><span class="t">${esc(d.metodo || 'Sin registrar')}</span><br><span class="s">${esc([fechaCorta(d.fecha), d.nota].filter(Boolean).join(' · '))}</span></span>
    <span class="r">${d.moneda === '$' ? D(d.monto) : S(d.monto)}<button class="del" data-act="delDev" data-id="${d.id}" aria-label="Borrar">✕</button></span></div>`).join('')}</div>` : ''}`;
}

function vAjustes() {
  const s = db.settings;
  return `<div class="card"><h2>Valores por defecto</h2>
    <div class="dos"><div><label>Tipo de cambio (S/ por $)</label><input id="a_tc" inputmode="decimal" value="${s.tc}"></div>
    <div><label>Tax %</label><input id="a_tax" inputmode="decimal" value="${s.tax}"></div></div>
    <label>Nombre de quien también compra</label><input id="a_socio" value="${esc(s.socio)}">
    <label>Formas de pago (separadas por coma)</label><input id="a_met" value="${esc(s.metodos.join(', '))}">
    <div class="acciones"><button class="btn pri" data-act="guardarAjustes">Guardar</button></div>
    <p class="nota">El tipo de cambio de aquí se usa para pedidos nuevos y para convertir lo de ${esc(s.socio)}. Cada pedido guarda el suyo.</p></div>
  <div class="card"><h2>Copia de seguridad</h2>
    <p class="nota" style="margin-top:0">Tus datos se guardan en este teléfono. Exporta una copia de vez en cuando, o activa el respaldo automático.</p>
    <div class="acciones"><button class="btn" data-act="exportar">Exportar copia</button><button class="btn" data-act="exportarCSV">Exportar a Excel</button></div>
    <div class="acciones"><button class="btn" data-act="importar">Importar</button></div></div>
  <div class="card"><h2>Respaldo automático en GitHub</h2>
    <p class="nota" style="margin-top:0">${gh.token ? `Activo en <b>${esc(gh.repo)}</b>. ${esc(estadoSync.msg || '')}` : 'Opcional. Guarda tus datos en un repositorio <b>privado</b> tuyo cada vez que cambias algo, y te permite recuperarlos en otro teléfono.'}</p>
    <div class="acciones"><button class="btn" data-act="configGH">${gh.token ? 'Cambiar' : 'Configurar'}</button>${gh.token ? '<button class="btn" data-act="syncAhora">Sincronizar ahora</button>' : ''}</div></div>
  <div class="card"><h2>Zona de peligro</h2><button class="btn peligro full" data-act="borrarTodo">Borrar todos los datos de este teléfono</button></div>`;
}

function render() {
  const v = { resumen: vResumen, pedidos: vMios, clientes: vClientes, socio: vSocio, ajustes: vAjustes }[ui.tab];
  $('#vista').innerHTML = v();
  $('#titulo').textContent = { resumen: 'Mis Pedidos', pedidos: 'Mis pedidos', clientes: 'Clientes', socio: db.settings.socio, ajustes: 'Ajustes' }[ui.tab];
  $('#tabSocio').textContent = db.settings.socio;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  $('#fab').hidden = ui.tab === 'ajustes';
  pintarSync();
}

/* ---------- Diálogos ---------- */
const dlg = $('#dlg'), cuerpo = $('#dlgBody');
function abrir(html) { cuerpo.innerHTML = html; if (!dlg.open) dlg.showModal(); cuerpo.scrollTop = 0; }
function cerrar() { if (dlg.open) dlg.close(); }
dlg.addEventListener('click', e => { if (e.target === dlg) cerrar(); });
const cab = t => `<div class="dh"><h3>${esc(t)}</h3><button class="x" data-act="cerrar" aria-label="Cerrar">✕</button></div>`;
const seg = (id, ops, val) => `<div class="seg" id="${id}" data-val="${esc(val)}">${ops.map(([v, l]) => `<button type="button" data-act="seg" data-v="${esc(v)}" class="${v === val ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
const selMetodo = (id, val) => `<select id="${id}"><option value="">Sin registrar</option>${db.settings.metodos.map(m => `<option ${m === val ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>`;
const item = id => db.items.find(i => i.id === id);

function dItem(id) {
  const it = item(id); if (!it) return cerrar();
  const c = calc(it), n = esc(db.settings.socio);
  abrir(`${cab(it.producto)}
  <div><span class="pill ${c.estado}">${esc(etiqueta(it, c))}</span> ${it.por === 'socio' ? `<span class="pill socio">Compró ${n}</span>` : ''}</div>
  <p class="nota">${esc([it.personal ? 'Uso personal' : it.cliente || 'Sin cliente', fechaCorta(it.fecha)].filter(Boolean).join(' · '))}</p>
  ${it.notas ? `<div class="aviso">${esc(it.notas)}</div>` : ''}
  <div class="card" style="margin-top:10px">
    <div class="kv"><span>Precio producto</span><span>${D(it.precioUSD || 0)}</span></div>
    <div class="kv"><span>Con tax (${it.tax}%)</span><span>${D(c.conTax)}</span></div>
    <div class="kv"><span>Comisión${it.comFija == null ? ` (${it.comPct}%)` : ''}</span><span>${D(c.com)}</span></div>
    ${it.por === 'socio' ? `<div class="kv"><span>A devolver a ${n}</span><span>${D(c.devUSD)}</span></div>` : ''}
    <div class="kv tot"><span>Costo (cambio ${c.tc})</span><span>${S(c.costoS)}</span></div>
    ${c.tieneVenta ? `<div class="kv"><span>Precio de venta</span><span>${it.monedaVenta === '$' ? D(it.venta) + ' ≈ ' : ''}${S(c.ventaS)}</span></div>
    <div class="kv"><span>Ganancia</span><span class="${c.ganS < 0 ? 'neg' : 'pos'}">${S(c.ganS)}</span></div>` : ''}
  </div>
  ${!it.personal ? `<div class="card"><h2>Pagos</h2>
    ${it.pagos.length ? it.pagos.map(p => `<div class="row"><span class="l"><span class="t">${esc(p.metodo || 'Sin registrar')}</span><br><span class="s">${esc([fechaCorta(p.fecha), p.nota].filter(Boolean).join(' · '))}</span></span>
      <span class="r">${p.moneda === '$' ? D(p.monto) : S(p.monto)}<button class="del" data-act="delPago" data-id="${it.id}" data-p="${p.id}" aria-label="Borrar pago">✕</button></span></div>`).join('') : '<p class="nota" style="margin:0">Todavía no ha pagado nada.</p>'}
    ${c.tieneVenta ? `<div class="kv tot"><span>Pagado</span><span>${S(c.pagadoS)}</span></div>
    <div class="kv"><span>Le falta</span><span class="${c.saldoS > 0.005 ? 'neg' : 'pos'}">${enMoneda(it, c, c.saldoS)}${it.monedaVenta === '$' ? ' ≈ ' + S(c.saldoS) : ''}</span></div>` : ''}
  </div>` : ''}
  <div class="acciones">${!it.personal ? `<button class="btn pri" data-act="nuevoPago" data-id="${it.id}">Registrar pago</button>` : ''}<button class="btn" data-act="editarItem" data-id="${it.id}">Editar</button></div>`);
}

function dFormItem(id, por) {
  const s = db.settings;
  const it = id ? item(id) : { fecha: hoy(), cliente: ui.tab === 'clientes' && ui.cliente ? ui.cliente : '', producto: '', precioUSD: null, tax: s.tax, comPct: por === 'socio' ? 0 : 10, comFija: null, tc: s.tc, venta: null, monedaVenta: 'S/', por: por || 'yo', devolver: null, personal: false, notas: '' };
  const v = x => (x == null ? '' : x);
  const nombres = [...new Set(db.items.map(i => i.cliente).filter(Boolean))].sort();
  abrir(`${cab(id ? 'Editar pedido' : 'Nuevo pedido')}
  <input type="hidden" id="f_id" value="${esc(id || '')}">
  <label>Producto</label><input id="f_producto" value="${esc(it.producto)}" autocomplete="off">
  <div class="dos"><div><label>Cliente</label><input id="f_cliente" list="dl" value="${esc(it.cliente)}" autocomplete="off" placeholder="Vacío = en venta"><datalist id="dl">${nombres.map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>
  <div><label>Fecha</label><input type="date" id="f_fecha" value="${esc(it.fecha)}"></div></div>
  <label>¿Quién lo compró?</label>${seg('f_por', [['yo', 'Yo'], ['socio', s.socio]], it.por)}
  <div class="tres"><div><label>Precio $</label><input id="f_precio" inputmode="decimal" value="${v(it.precioUSD)}"></div>
  <div><label>Tax %</label><input id="f_tax" inputmode="decimal" value="${v(it.tax)}"></div>
  <div><label>Cambio</label><input id="f_tc" inputmode="decimal" value="${v(it.tc)}"></div></div>
  <div class="dos"><div><label>Comisión %</label><input id="f_com" inputmode="decimal" value="${v(it.comPct)}"></div>
  <div><label>o comisión fija $</label><input id="f_comf" inputmode="decimal" value="${v(it.comFija)}" placeholder="Opcional"></div></div>
  <div id="f_devWrap"><label>A devolver a ${esc(s.socio)} ($)</label><input id="f_dev" inputmode="decimal" value="${v(it.devolver)}" placeholder="Vacío = el costo"></div>
  <label>Precio de venta</label><div class="dos"><input id="f_venta" inputmode="decimal" value="${v(it.venta)}" placeholder="Lo que cobras">${seg('f_mon', [['S/', 'Soles'], ['$', 'Dólares']], it.monedaVenta)}</div>
  <label class="check"><input type="checkbox" id="f_personal" ${it.personal ? 'checked' : ''}> Es para mí (uso personal)</label>
  <label>Notas</label><textarea id="f_notas">${esc(it.notas)}</textarea>
  <div class="calc" id="f_calc"></div>
  <div class="acciones"><button class="btn pri" data-act="guardarItem">Guardar</button>${id ? `<button class="btn peligro" data-act="delItem" data-id="${id}">Borrar</button>` : ''}</div>`);
  previa();
}
function leerForm() {
  const g = id => $('#' + id).value;
  const prev = item(g('f_id'));
  return {
    id: g('f_id') || uid(), fecha: g('f_fecha'), cliente: g('f_cliente').trim(), producto: g('f_producto').trim(),
    precioUSD: num(g('f_precio')), tax: num(g('f_tax')) || 0, comPct: num(g('f_com')) || 0, comFija: num(g('f_comf')),
    tc: num(g('f_tc')) || db.settings.tc, venta: num(g('f_venta')), monedaVenta: $('#f_mon').dataset.val,
    por: $('#f_por').dataset.val, devolver: $('#f_por').dataset.val === 'socio' ? num(g('f_dev')) : null,
    personal: $('#f_personal').checked, notas: g('f_notas').trim(), pagos: prev ? prev.pagos : []
  };
}
function previa() {
  if (!$('#f_calc')) return;
  const it = leerForm(), c = calc(it);
  $('#f_devWrap').hidden = it.por !== 'socio';
  $('#f_calc').innerHTML = `Costo: <b>${D(it.por === 'socio' ? c.devUSD : c.costoUSD)}</b> = <b>${S(c.costoS)}</b>` +
    (c.tieneVenta ? `<br>Venta: <b>${S(c.ventaS)}</b> · Ganancia: <b class="${c.ganS < 0 ? 'neg' : 'pos'}">${S(c.ganS)}</b>` : '');
}

function dPago(id) {
  const it = item(id), c = calc(it);
  const mon = it.monedaVenta, sug = c.saldoS > 0.005 ? (mon === '$' ? c.saldoS / c.tc : c.saldoS) : null;
  abrir(`${cab('Registrar pago')}<p class="nota" style="margin-top:0">${esc(it.producto)}${it.cliente ? ' · ' + esc(it.cliente) : ''}${sug ? ' · le falta ' + enMoneda(it, c, c.saldoS) : ''}</p>
  ${formPago(sug, mon)}<div class="acciones"><button class="btn pri" data-act="guardarPago" data-id="${id}">Guardar pago</button></div>`);
}
const formPago = (monto, mon) => `<label>Monto</label><div class="dos"><input id="p_monto" inputmode="decimal" value="${monto ? Math.round(monto * 100) / 100 : ''}">${seg('p_mon', [['S/', 'Soles'], ['$', 'Dólares']], mon)}</div>
  <div class="dos"><div><label>¿Por dónde?</label>${selMetodo('p_met', '')}</div><div><label>Fecha</label><input type="date" id="p_fecha" value="${hoy()}"></div></div>
  <label>Nota</label><input id="p_nota" autocomplete="off" placeholder="Opcional">`;
const leerPago = () => ({ id: uid(), fecha: $('#p_fecha').value, monto: num($('#p_monto').value), moneda: $('#p_mon').dataset.val, metodo: $('#p_met').value, nota: $('#p_nota').value.trim() });

function dPagoCliente(nombre) {
  const c = clientes().find(x => clave(x.nombre) === clave(nombre)); if (!c) return;
  abrir(`${cab('Pago de ' + c.nombre)}<p class="nota" style="margin-top:0">Le falta ${S(c.saldoS)} en total. El pago se reparte entre sus pedidos pendientes, del más antiguo al más nuevo.</p>
  ${formPago(c.saldoS, 'S/')}<div class="acciones"><button class="btn pri" data-act="guardarPagoCliente" data-c="${esc(c.nombre)}">Guardar pago</button></div>`);
}
function repartirPago(nombre, pago) {
  const pend = db.items.filter(i => !i.personal && clave(i.cliente) === clave(nombre) && calc(i).saldoS > 0.005)
    .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '') || db.items.indexOf(a) - db.items.indexOf(b));
  if (!pend.length) return false;
  let resto = pago.monto; // en la moneda del pago
  pend.forEach((it, k) => {
    if (resto <= 0.005) return;
    const c = calc(it), saldo = pago.moneda === '$' ? c.saldoS / c.tc : c.saldoS;
    const m = k === pend.length - 1 ? resto : Math.min(resto, saldo);
    it.pagos.push({ ...pago, id: uid(), monto: Math.round(m * 100) / 100 });
    resto -= m;
  });
  return true;
}

function dDev() {
  abrir(`${cab('Devolución a ' + db.settings.socio)}${formPago(null, '$')}<div class="acciones"><button class="btn pri" data-act="guardarDev">Guardar</button></div>`);
}

function dImportar() {
  abrir(`${cab('Importar datos')}<p class="nota" style="margin-top:0">Elige el archivo de copia (.json), o pega aquí su contenido. <b>Reemplaza</b> lo que hay ahora en este teléfono.</p>
  <input type="file" id="i_file" accept=".json,application/json,text/plain" style="margin:8px 0">
  <label>o pega el contenido</label><textarea id="i_txt" placeholder='{"version":1, ...}'></textarea>
  <div class="acciones"><button class="btn pri" data-act="hacerImportar">Importar</button></div>`);
}
function dGH() {
  abrir(`${cab('Respaldo en GitHub')}
  <p class="nota" style="margin-top:0">1. Crea un repositorio <b>privado</b> en GitHub (por ejemplo <i>pedidos-datos</i>).<br>2. En GitHub → Settings → Developer settings → Fine-grained tokens, crea un token con acceso <b>solo a ese repositorio</b> y permiso <b>Contents: Read and write</b>.<br>3. Pega ambos aquí. El token se guarda solo en este teléfono.</p>
  <label>Repositorio (usuario/nombre)</label><input id="g_repo" value="${esc(gh.repo || '')}" autocapitalize="off" autocomplete="off" placeholder="usuario/pedidos-datos">
  <label>Token</label><input type="password" id="g_token" value="${esc(gh.token || '')}" autocomplete="off" placeholder="github_pat_…">
  <div class="acciones"><button class="btn pri" data-act="guardarGH">Guardar y probar</button>${gh.token ? '<button class="btn peligro" data-act="quitarGH">Desactivar</button>' : ''}</div>`);
}

/* ---------- Exportar / importar ---------- */
async function entregar(nombre, texto, tipo) {
  const file = new File([texto], nombre, { type: tipo });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = nombre; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function csv() {
  const q = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const r2 = n => Math.round(n * 100) / 100;
  const filas = [['Fecha', 'Cliente', 'Producto', 'Comprado por', 'Precio USD', '% Tax', 'Precio con tax ($)', 'Comisión ($)', 'Tipo de cambio', 'Costo ($)', 'Costo (S/)', 'Precio de venta', 'Moneda venta', 'Venta (S/)', 'Pagado (S/)', 'Saldo por cobrar (S/)', 'Ganancia (S/)', 'Formas de pago', 'Estado', 'Notas']];
  for (const it of db.items) {
    const c = calc(it);
    filas.push([it.fecha, it.cliente, it.producto, it.por === 'socio' ? db.settings.socio : 'Yo', it.precioUSD, it.tax, r2(c.conTax), r2(c.com), c.tc, r2(it.por === 'socio' ? c.devUSD : c.costoUSD), r2(c.costoS),
      it.venta, it.monedaVenta, r2(c.ventaS), r2(c.pagadoS), r2(c.saldoS), c.ganS == null ? '' : r2(c.ganS), [...new Set(it.pagos.map(p => p.metodo).filter(Boolean))].join(' / '), etiqueta(it, c), it.notas]);
  }
  return '﻿' + filas.map(f => f.map(q).join(',')).join('\r\n');
}

/* ---------- Respaldo en GitHub ---------- */
const estadoSync = { est: '', msg: '' };
let tSubida = null, sucio = false, subiendo = false;
const b64 = s => { const b = new TextEncoder().encode(s); let o = ''; for (let i = 0; i < b.length; i += 8192) o += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return btoa(o); };
const deB64 = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));
async function api(metodo, cuerpoJson) {
  const r = await fetch(`https://api.github.com/repos/${gh.repo}/contents/datos.json`, {
    method: metodo, cache: 'no-store',
    headers: { Authorization: 'Bearer ' + gh.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: cuerpoJson ? JSON.stringify(cuerpoJson) : undefined
  });
  if (r.status === 404 && metodo === 'GET') return null;
  if (!r.ok) throw Object.assign(new Error(r.status === 401 ? 'Token inválido o vencido' : r.status === 404 ? 'No encuentro el repositorio (¿nombre o permisos?)' : r.status === 403 ? 'El token no tiene permiso de escritura' : 'GitHub respondió ' + r.status), { status: r.status });
  return r.json();
}
function marcar(est, msg) { estadoSync.est = est; estadoSync.msg = msg || ''; pintarSync(); }
function pintarSync() {
  const b = $('#sync'); b.hidden = !gh.token;
  b.className = 'sync' + (estadoSync.est === 'err' ? ' err' : '');
  b.textContent = { ok: '☁ Guardado', sub: '☁ Guardando…', err: '☁ Sin respaldo', pend: '☁ Pendiente' }[estadoSync.est] || '☁';
}
async function bajar() {
  const j = await api('GET'); if (!j) { gh.sha = null; return null; }
  gh.sha = j.sha; localStorage.setItem(LSG, JSON.stringify(gh));
  // Para archivos de más de 1 MB la API no incluye el contenido: se pide en crudo.
  if (j.content) return normalizar(JSON.parse(deB64(j.content)));
  const r = await fetch(j.url, { cache: 'no-store', headers: { Authorization: 'Bearer ' + gh.token, Accept: 'application/vnd.github.raw+json' } });
  return normalizar(await r.json());
}
async function subir() {
  if (!gh.token || subiendo) return;
  subiendo = true; sucio = false; marcar('sub');
  try {
    const cuerpo = { message: 'Datos ' + new Date().toISOString().slice(0, 16).replace('T', ' '), content: b64(JSON.stringify(db, null, 1)) };
    if (gh.sha) cuerpo.sha = gh.sha;
    let j;
    try { j = await api('PUT', cuerpo); }
    catch (e) { if (e.status !== 409 && e.status !== 422) throw e; const a = await api('GET'); if (a) cuerpo.sha = a.sha; j = await api('PUT', cuerpo); }
    gh.sha = j.content.sha; localStorage.setItem(LSG, JSON.stringify(gh));
    marcar('ok', 'Último respaldo: ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '.');
  } catch (e) { sucio = true; marcar('err', navigator.onLine ? e.message : 'Sin conexión; se guardará luego.'); }
  subiendo = false;
  if (sucio && estadoSync.est !== 'err') programarSubida();
}
function programarSubida() {
  if (!gh.token) return;
  sucio = true; marcar('pend'); clearTimeout(tSubida); tSubida = setTimeout(subir, 1500);
}
async function sincronizar(alIniciar) {
  if (!gh.token) return;
  try {
    marcar('sub');
    const remoto = await bajar();
    if (remoto && (!db.updatedAt || remoto.updatedAt > db.updatedAt) && !(alIniciar && sucio)) {
      db = remoto; localStorage.setItem(LS, JSON.stringify(db)); render(); marcar('ok', 'Datos al día.');
    } else if (!remoto || remoto.updatedAt < db.updatedAt) await subir();
    else marcar('ok', 'Datos al día.');
  } catch (e) { marcar('err', navigator.onLine ? e.message : 'Sin conexión.'); }
}

/* ---------- Acciones ---------- */
let tToast;
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(tToast); tToast = setTimeout(() => (t.hidden = true), 2600); }

const acts = {
  tab(e) { if (ui.tab !== e.dataset.tab) { ui.q = ''; ui.filtro = 'todos'; } ui.tab = e.dataset.tab; ui.cliente = null; render(); scrollTo(0, 0); },
  filtro(e) { ui.filtro = e.dataset.f; render(); },
  verCliente(e) { ui.tab = 'clientes'; ui.cliente = e.dataset.c || null; render(); scrollTo(0, 0); },
  verItem(e) { dItem(e.dataset.id); },
  editarItem(e) { dFormItem(e.dataset.id); },
  nuevoItem(e) { dFormItem(null, e.dataset.por); },
  cerrar,
  seg(e) { const s = e.parentElement; s.dataset.val = e.dataset.v; [...s.children].forEach(b => b.classList.toggle('on', b === e)); previa(); },
  guardarItem() {
    const it = leerForm();
    if (!it.producto) return toast('Ponle un nombre al producto');
    const i = db.items.findIndex(x => x.id === it.id);
    if (i >= 0) db.items[i] = it; else db.items.push(it);
    guardar(); dItem(it.id); toast('Guardado');
  },
  delItem(e) { if (!confirm('¿Borrar este pedido y sus pagos?')) return; db.items = db.items.filter(i => i.id !== e.dataset.id); cerrar(); guardar(); toast('Pedido borrado'); },
  nuevoPago(e) { dPago(e.dataset.id); },
  guardarPago(e) {
    const p = leerPago(); if (!p.monto || p.monto <= 0) return toast('Escribe el monto');
    item(e.dataset.id).pagos.push(p); guardar(); dItem(e.dataset.id); toast('Pago registrado');
  },
  delPago(e) { if (!confirm('¿Borrar este pago?')) return; const it = item(e.dataset.id); it.pagos = it.pagos.filter(p => p.id !== e.dataset.p); guardar(); dItem(it.id); },
  pagoCliente(e) { dPagoCliente(e.dataset.c); },
  guardarPagoCliente(e) {
    const p = leerPago(); if (!p.monto || p.monto <= 0) return toast('Escribe el monto');
    if (!repartirPago(e.dataset.c, p)) return toast('No tiene pedidos pendientes');
    cerrar(); guardar(); toast('Pago registrado');
  },
  nuevaDev: dDev,
  guardarDev() { const p = leerPago(); if (!p.monto || p.monto <= 0) return toast('Escribe el monto'); db.devoluciones.push(p); cerrar(); guardar(); toast('Devolución registrada'); },
  delDev(e) { if (!confirm('¿Borrar esta devolución?')) return; db.devoluciones = db.devoluciones.filter(d => d.id !== e.dataset.id); guardar(); },
  guardarAjustes() {
    const s = db.settings;
    s.tc = num($('#a_tc').value) || s.tc; s.tax = num($('#a_tax').value) ?? s.tax;
    s.socio = $('#a_socio').value.trim() || s.socio;
    const m = $('#a_met').value.split(',').map(x => x.trim()).filter(Boolean); if (m.length) s.metodos = m;
    guardar(); toast('Ajustes guardados');
  },
  exportar() { entregar(`pedidos-copia-${hoy()}.json`, JSON.stringify(db, null, 1), 'application/json'); },
  exportarCSV() { entregar(`pedidos-${hoy()}.csv`, csv(), 'text/csv'); },
  importar: dImportar,
  async cargarCifrado() {
    const clave = $('#clave').value.trim(); if (!clave) return toast('Escribe la clave');
    try {
      const r = await fetch('datos.cifrado.json', { cache: 'no-store' }); if (!r.ok) throw new Error('red');
      const f = await r.json(), bin = x => Uint8Array.from(atob(x), c => c.charCodeAt(0));
      const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveKey']);
      const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: bin(f.salt), iterations: f.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      let txt;
      try { txt = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bin(f.iv) }, key, bin(f.data))); }
      catch (e) { return toast('Clave incorrecta'); }
      db = normalizar(JSON.parse(txt)); ui.tab = 'resumen'; guardar(); toast(`${db.items.length} pedidos cargados`);
    } catch (e) { toast('No se pudo cargar. Revisa tu conexión.'); }
  },
  async hacerImportar() {
    try {
      const f = $('#i_file').files[0], txt = f ? await f.text() : $('#i_txt').value;
      if (!txt.trim()) return toast('Elige un archivo o pega el contenido');
      const nuevo = normalizar(JSON.parse(txt));
      if (db.items.length && !confirm(`Esto reemplaza los ${db.items.length} pedidos que hay ahora por los ${nuevo.items.length} del archivo. ¿Continuar?`)) return;
      db = nuevo; cerrar(); ui.tab = 'resumen'; guardar(); toast(`${db.items.length} pedidos importados`);
    } catch (e) { toast(e instanceof SyntaxError ? 'El contenido no es una copia válida' : e.message); }
  },
  configGH: dGH,
  async guardarGH() {
    const repo = $('#g_repo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, ''), token = $('#g_token').value.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) return toast('Completa repositorio (usuario/nombre) y token');
    const antes = gh; gh = { repo, token, sha: null };
    try {
      const remoto = await bajar();
      localStorage.setItem(LSG, JSON.stringify(gh)); cerrar();
      if (remoto && remoto.items.length && (!db.items.length || confirm(`En GitHub hay una copia con ${remoto.items.length} pedidos.\n\nAceptar = traer esa copia a este teléfono.\nCancelar = subir lo de este teléfono y reemplazarla.`))) {
        db = remoto; localStorage.setItem(LS, JSON.stringify(db)); marcar('ok', 'Datos al día.');
      } else await subir();
      render(); toast('Respaldo activado');
    } catch (e) { gh = antes; toast(e.message); }
  },
  quitarGH() { if (!confirm('¿Desactivar el respaldo? Tus datos siguen en este teléfono.')) return; gh = {}; localStorage.removeItem(LSG); cerrar(); render(); },
  syncAhora() { sincronizar(false).then(() => { render(); toast(estadoSync.est === 'err' ? estadoSync.msg : 'Sincronizado'); }); },
  borrarTodo() {
    if (!confirm('¿Borrar TODOS los pedidos y pagos de este teléfono? No se puede deshacer.')) return;
    if (!confirm('¿Segura? Exporta una copia antes si no la tienes.')) return;
    const s = db.settings; db = base(); db.settings = s; guardar(); toast('Datos borrados');
  }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = acts[el.dataset.act]; if (fn) fn(el);
});
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) acts.tab(b); });
$('#fab').addEventListener('click', () => dFormItem(null, ui.tab === 'socio' ? 'socio' : 'yo'));
$('#sync').addEventListener('click', () => { if (estadoSync.est === 'err') toast(estadoSync.msg); acts.syncAhora(); });
document.addEventListener('input', e => {
  if (e.target.id === 'q') {
    ui.q = e.target.value; const pos = e.target.selectionStart; render();
    const q = $('#q'); q.focus(); q.setSelectionRange(pos, pos);
  } else if (e.target.closest('#dlgBody') && /^f_/.test(e.target.id)) previa();
});
document.addEventListener('change', e => { if (e.target.id === 'f_personal') previa(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && sucio) { clearTimeout(tSubida); subir(); } });
addEventListener('online', () => { if (sucio) subir(); });

render();
sincronizar(true);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
