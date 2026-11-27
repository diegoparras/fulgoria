// Modelo económico de un caso: primero se decide QUÉ PASÓ en el mes (cobranzas, pagos,
// cheques, impuestos…) y recién después se escribe cómo lo muestra el banco y cómo lo registró
// el libro. Así la respuesta correcta (qué empareja con qué, qué queda pendiente y de qué tipo)
// se conoce de antemano y queda en esperado.json.
import { EMPRESAS, PERSONAS, SERVICIOS, cuit, fmtCuit, iso, addDays, lastDay, habil, MESES, pct } from "./lib.mjs";

/**
 * Libro de verdad de un caso. `B` = líneas del extracto, `L` = registros del mayor.
 * Las relaciones se arman sobre índices de inserción y se re-numeran al ordenar por fecha.
 */
export class Caso {
  constructor({ r, anio, mes, voc, cliente }) {
    Object.assign(this, { r, anio, mes, voc, cliente });
    this.B = []; this.L = []; this.pares = []; this.pend = [];
    this.desde = iso(anio, mes, 1);
    this.hasta = iso(anio, mes, lastDay(anio, mes));
    this.seqComp = r.int(100, 900); this.seqCheque = r.int(1000, 90000); this.seqAsiento = r.int(1, 400);
  }
  // Una línea del extracto. tipo = lo que ES (vocabulario del clasificador).
  // Las fechas que caerían fuera del período (un lag que pasa a otro mes) se acotan al período.
  b(fecha, cents, desc, tipo) { this.B.push({ fecha: this.acotar(fecha), cents, desc, tipo }); return this.B.length - 1; }
  // Un registro del mayor (cents > 0 = Debe, < 0 = Haber).
  l(fecha, cents, desc, comp = "") { this.L.push({ fecha: this.acotar(fecha), cents, desc, comp, asiento: ++this.seqAsiento }); return this.L.length - 1; }
  acotar(f) { return f < this.desde ? this.desde : f > this.hasta ? this.hasta : f; }
  par(b, l, tipo = "uno_a_uno") { this.pares.push({ b: [].concat(b), l: [].concat(l), tipo }); }
  pendB(i, tipo) { this.pend.push({ lado: "banco", i, tipo }); }
  pendL(i, tipo) { this.pend.push({ lado: "libros", i, tipo }); }
  // Fechas
  dia() { return habil(iso(this.anio, this.mes, this.r.int(1, lastDay(this.anio, this.mes) - 2))); }
  enMes(f) { return f >= this.desde && f <= this.hasta; }
  comp(pv = "0001") { return `${pv}-${String(++this.seqComp).padStart(8, "0")}`; }
  cheque() { return String(this.seqCheque += this.r.int(1, 7)).padStart(8, "0"); }
}

// ---------------------------------------------------------------- eventos de negocio
// Cada evento escribe las líneas de ambos lados y su relación correcta.

/** Ruido fiscal que el banco agrega a un movimiento (impuesto ley 25.413, SIRCREB). */
function ruido(c, fecha, cents, { sircreb = true } = {}) {
  const { voc, cliente } = c;
  const out = [];
  if (cliente.imp25413) {
    const imp = pct(cents, 0.6);
    if (imp > 0) out.push(c.b(fecha, -imp, cents > 0 ? voc.impCred() : voc.impDeb(), "impuesto_25413"));
  }
  if (cents > 0 && sircreb && cliente.sircreb) {
    const ret = pct(cents, cliente.sircreb);
    if (ret > 0) out.push(c.b(fecha, -ret, voc.sircreb(), "retencion_iibb"));
  }
  return out; // índices de líneas solo-banco (ajustes)
}

function cobranzaTrf(c, { fecha = c.dia(), lag = c.r.int(0, 2), conRef = c.r.chance(0.35), monto } = {}) {
  const { r, voc } = c;
  const quien = r.pick(EMPRESAS), q = cuit(r), comp = c.comp(r.pick(["0001", "0002", "0003"]));
  const cents = monto ?? r.cents(80000, 4500000);
  const fb = habil(addDays(fecha, lag));
  const bi = c.b(fb, cents, voc.trfRecibida(quien, fmtCuit(q), conRef ? comp : null), "transferencia");
  const li = c.l(fecha, cents, r.pick([`Cobranza ${quien} Rec. ${c.comp("0001")}`, `Cobro FC A ${comp} ${quien}`, `Cobranza cliente ${quien}`]), comp);
  c.par(bi, li, conRef ? "referencia" : "uno_a_uno");
  return { bi, li, fb, cents, extras: ruido(c, fb, cents) };
}

function pagoTrf(c, { fecha = c.dia(), lag = c.r.int(0, 1), monto } = {}) {
  const { r, voc } = c;
  const quien = r.pick(EMPRESAS), op = c.comp("0001");
  const cents = -(monto ?? r.cents(50000, 3000000));
  const fb = habil(addDays(fecha, lag));
  const bi = c.b(fb, cents, voc.trfEnviada(quien, fmtCuit(cuit(r))), "transferencia");
  const li = c.l(fecha, cents, r.pick([`Pago ${quien} OP ${op}`, `Pago a proveedor ${quien}`, `Transferencia a ${quien} OP ${op}`]), `OP ${op}`);
  c.par(bi, li);
  return { bi, li, fb, extras: ruido(c, fb, cents) };
}

/** Cheque emitido: el libro lo registra al emitirlo; el banco lo debita cuando lo presentan. */
function chequeEmitido(c, { fecha = c.dia(), lag = c.r.int(1, 25), echeq = c.r.chance(0.3) } = {}) {
  const { r, voc } = c;
  const quien = r.pick(EMPRESAS), nro = c.cheque();
  const cents = -r.cents(40000, 2500000);
  const li = c.l(fecha, cents, `${echeq ? "ECHEQ" : "Cheque"} N° ${nro} a ${quien}`, `CH ${nro}`);
  const fb = habil(addDays(fecha, lag));
  if (c.enMes(fb)) {
    const bi = c.b(fb, cents, echeq ? voc.echeq(nro) : voc.cheque(nro), "cheque");
    c.par(bi, li, "referencia");
    ruido(c, fb, cents);
  } else c.pendL(li, "cheque_pendiente");
  return { li };
}

/** Varias cobranzas en efectivo que se depositan juntas (N:1). */
function depositoAgrupado(c, { n = c.r.int(2, 4) } = {}) {
  const { r, voc } = c;
  const fd = c.dia();
  const ls = [];
  let tot = 0;
  for (let k = 0; k < n; k++) {
    const cents = r.cents(20000, 900000); tot += cents;
    ls.push(c.l(addDays(fd, -r.int(0, 3)), cents, `Cobranza ${r.pick(PERSONAS)} - efectivo a depositar`, `RC ${c.comp("0001")}`));
  }
  const bi = c.b(fd, tot, voc.depositoEfectivo(), "deposito");
  c.par(bi, ls, "agrupado");
  ruido(c, fd, tot, { sircreb: false });
}

/** Depósito de cheques de terceros: si cae cerca del cierre, queda en tránsito. */
function depositoCheques(c, { transito = false } = {}) {
  const { r, voc } = c;
  const cents = r.cents(50000, 1500000);
  const fl = transito ? addDays(c.hasta, -r.int(0, 2)) : c.dia();
  const li = c.l(fl, cents, r.pick(["Depósito cheques de terceros", "Depósito valores a depositar", "Depósito cheque cliente"]));
  const fb = habil(addDays(fl, r.int(1, 2)));
  if (!transito && c.enMes(fb)) { const bi = c.b(fb, cents, voc.depositoCheques(), "deposito"); c.par(bi, li); ruido(c, fb, cents, { sircreb: false }); }
  else c.pendL(li, "deposito_transito");
}

function debitoAutomatico(c, { adelantoLibro = c.r.int(0, 3) } = {}) {
  const { r, voc } = c;
  const serv = r.pick(SERVICIOS), cents = -r.cents(15000, 350000);
  const fb = c.dia();
  const bi = c.b(fb, cents, voc.debitoAutomatico(serv), "debito_automatico");
  const li = c.l(addDays(fb, -adelantoLibro), cents, `${serv} - débito automático`);
  c.par(bi, li);
  ruido(c, fb, cents);
}

/** Sueldos: varios importes, a veces idénticos (el caso de ambigüedad más común). */
function sueldos(c, { n = c.r.int(2, 6), iguales = c.r.chance(0.5) } = {}) {
  const { r, voc } = c;
  const fb = habil(iso(c.anio, c.mes, r.int(1, 5)));
  const base = r.cents(900000, 2500000);
  for (let k = 0; k < n; k++) {
    const p = PERSONAS[(k * 7 + r.int(0, 3)) % PERSONAS.length];
    const cents = -(iguales ? base : r.cents(900000, 2500000));
    const bi = c.b(fb, cents, voc.sueldo(p), "sueldos");
    const li = c.l(fb, cents, `Sueldo ${MESES[(c.mes + 10) % 12]} - ${p}`);
    c.par(bi, li);
    ruido(c, fb, cents);
  }
}

function vep(c) {
  const { r, voc } = c;
  const nro = String(r.int(100000000, 999999999)), cents = -r.cents(50000, 2000000);
  const fb = c.dia();
  const bi = c.b(fb, cents, voc.vep(nro), "vep_arca");
  const li = c.l(fb, cents, r.pick([`F.931 VEP ${nro}`, `Pago IVA VEP ${nro}`, `Anticipo Ganancias VEP ${nro}`]), `VEP ${nro}`);
  c.par(bi, li, "referencia");
  ruido(c, fb, cents);
}

/** Liquidación de tarjeta. neta=true: el libro registra el neto (empareja exacto).
 *  neta=false: el libro registra la venta bruta y por separado arancel e IVA (1 banco = N libros con signos mezclados). */
function tarjeta(c, { neta = true } = {}) {
  const { r, voc } = c;
  const bruto = r.cents(100000, 3000000), arancel = pct(bruto, r.pick([1.8, 2.5, 3.0])), iva = pct(arancel, 21);
  const neto = bruto - arancel - iva;
  const fb = c.dia(), lote = String(r.int(1000, 99999));
  const bi = c.b(fb, neto, voc.tarjeta(lote), "tarjeta_liquidacion");
  if (neta) c.par(bi, c.l(fb, neto, `Liquidación tarjeta lote ${lote}`));
  else c.par(bi, [c.l(fb, bruto, `Ventas con tarjeta lote ${lote}`), c.l(fb, -arancel, `Arancel tarjeta lote ${lote}`), c.l(fb, -iva, `IVA arancel lote ${lote}`)], "bruto_neto");
  ruido(c, fb, neto);
}

/** Mercado Pago: el libro registra cada venta, el banco recibe un retiro que las junta. */
function mercadoPago(c, { n = c.r.int(3, 8) } = {}) {
  const { r, voc } = c;
  const fb = c.dia();
  const ls = []; let tot = 0;
  for (let k = 0; k < n; k++) { const cents = r.cents(5000, 300000); tot += cents; ls.push(c.l(addDays(fb, -r.int(0, 4)), cents, `Venta MP #${r.int(10000000, 99999999)}`)); }
  const bi = c.b(fb, tot, voc.mercadoPago(), "mercadopago");
  c.par(bi, ls, "agrupado");
  ruido(c, fb, tot);
}

/** Gastos bancarios del mes (comisión, IVA, percepción) e intereses: solo banco. */
function gastosBancarios(c) {
  const { r, voc } = c;
  const fb = habil(addDays(c.hasta, -r.int(2, 6)));
  const com = r.cents(15000, 60000);
  const out = [c.b(fb, -com, voc.comision(), "comision"), c.b(fb, -pct(com, 21), voc.ivaComision(), "iva_comision")];
  if (c.cliente.percepcionIVA) out.push(c.b(fb, -pct(com, 3), voc.percepcionIVA(), "percepcion_iva"));
  for (const i of out) ruido(c, fb, c.B[i].cents, { sircreb: false });
  return out;
}
function intereses(c) {
  const fb = c.dia(), cents = c.r.cents(5000, 400000);
  return [c.b(fb, cents, c.voc.intereses(), "interes_ganado")];
}

function creditoNoIdentificado(c) {
  const { r, voc } = c;
  const fb = c.dia(), cents = r.cents(30000, 900000);
  const bi = c.b(fb, cents, voc.trfRecibida(r.pick(PERSONAS), fmtCuit(cuit(r, true)), null), "transferencia");
  c.pendB(bi, "credito_no_identificado");
  ruido(c, fb, cents);
}
function debitoNoIdentificado(c) {
  const { r, voc } = c;
  const fb = c.dia(), cents = -r.cents(10000, 400000);
  const bi = c.b(fb, cents, voc.debitoAutomatico(r.pick(SERVICIOS)), "debito_automatico");
  c.pendB(bi, "debito_no_identificado");
  ruido(c, fb, cents);
}

/** Cheque de tercero depositado y rechazado: el libro registró el depósito; el banco lo acredita,
 *  después lo debita como rechazado y cobra una comisión. */
function chequeRechazado(c) {
  const { r, voc } = c;
  const cents = r.cents(50000, 800000), nro = c.cheque();
  const fl = habil(iso(c.anio, c.mes, r.int(2, 15)));
  const li = c.l(fl, cents, `Depósito cheque N° ${nro} cliente ${r.pick(EMPRESAS)}`, `CH ${nro}`);
  const fb = habil(addDays(fl, 1));
  const bi = c.b(fb, cents, voc.depositoCheques(), "deposito");
  c.par(bi, li);
  const fr = habil(addDays(fb, r.int(2, 5)));
  c.pendB(c.b(fr, -cents, voc.chequeRechazado(nro), "cheque"), "debito_no_identificado");
  c.pendB(c.b(fr, -r.cents(3000, 15000), voc.comisionRechazo(), "comision"), "ajuste_bancario");
}

// ---------------------------------------------------------------- escenarios
// Cada escenario mezcla eventos con un foco. `cliente` define el ruido fiscal y cómo registra
// el libro los gastos bancarios ("sin_registrar": el estudio los asienta al conciliar;
// "consolidado": un asiento mensual por concepto; "uno_a_uno": cada línea).

export const ESCENARIOS = {
  basico: { titulo: "Básico", desc: "Pocos movimientos, la mayoría 1 a 1, gastos bancarios sin registrar, un cheque pendiente y un depósito en tránsito." },
  ruido_fiscal: { titulo: "Ruido fiscal", desc: "Impuesto ley 25.413 en cada movimiento, SIRCREB en cada acreditación, comisiones con IVA y percepción. Nada de eso está en el libro." },
  cheques: { titulo: "Cheques y ECHEQ", desc: "Muchos cheques emitidos que se debitan días después, varios pendientes al cierre y un cheque de tercero rechazado." },
  agrupados: { titulo: "Agrupados", desc: "Depósitos que juntan varias cobranzas y retiros de Mercado Pago que juntan muchas ventas (algunos con más de 4 partidas)." },
  repetidos: { titulo: "Importes repetidos", desc: "Sueldos idénticos el mismo día, alquileres y cuotas iguales: la ambigüedad que nunca debe quedar en verde." },
  desfasaje: { titulo: "Desfasaje de fechas", desc: "El libro registra con días de diferencia respecto del banco, algunos más allá de la ventana por defecto." },
  consolidados: { titulo: "Gastos consolidados", desc: "El cliente registra los gastos e impuestos bancarios en un solo asiento mensual por concepto (1 libro = muchas líneas del banco)." },
  tarjetas_brutas: { titulo: "Tarjetas en bruto", desc: "El libro registra la venta con tarjeta en bruto y aparte el arancel y su IVA; el banco acredita el neto." },
  errores: { titulo: "Errores de registración", desc: "Importe transpuesto, registro duplicado, créditos que el cliente no registró e ingresos registrados que nunca llegaron al banco." },
  volumen: { titulo: "Volumen", desc: "Un mes con cientos de movimientos repartidos en varias páginas." },
};

export function generarEscenario(c, esc) {
  const r = c.r;
  const rep = (n, f) => { for (let k = 0; k < n; k++) f(k); };
  const ajustesSinRegistrar = (idxs) => idxs.forEach((i) => c.pendB(i, "ajuste_bancario"));

  switch (esc) {
    case "basico":
      rep(r.int(4, 8), () => cobranzaTrf(c));
      rep(r.int(3, 6), () => pagoTrf(c));
      rep(r.int(1, 2), () => debitoAutomatico(c));
      chequeEmitido(c, { fecha: addDays(c.hasta, -r.int(2, 6)), lag: 10 });
      depositoCheques(c, { transito: true });
      ajustesSinRegistrar(gastosBancarios(c));
      break;
    case "ruido_fiscal":
      c.cliente.imp25413 = true; c.cliente.sircreb = r.pick([0.5, 1.2, 2.5, 3.0]); c.cliente.percepcionIVA = true;
      rep(r.int(6, 12), () => cobranzaTrf(c));
      rep(r.int(5, 10), () => pagoTrf(c));
      rep(r.int(1, 3), () => debitoAutomatico(c));
      vep(c);
      ajustesSinRegistrar(gastosBancarios(c));
      ajustesSinRegistrar(intereses(c));
      break;
    case "cheques":
      rep(r.int(8, 16), () => chequeEmitido(c));
      rep(r.int(2, 4), () => chequeEmitido(c, { fecha: addDays(c.hasta, -r.int(1, 8)), lag: r.int(10, 30) }));
      rep(r.int(1, 2), () => chequeEmitido(c, { fecha: habil(iso(c.anio, c.mes, r.int(1, 3))), lag: 40 })); // viejos sin debitar
      rep(r.int(3, 6), () => cobranzaTrf(c));
      depositoCheques(c);
      chequeRechazado(c);
      ajustesSinRegistrar(gastosBancarios(c));
      break;
    case "agrupados":
      rep(r.int(3, 6), () => depositoAgrupado(c));
      rep(r.int(2, 4), () => mercadoPago(c, { n: r.int(3, 9) }));
      rep(r.int(2, 4), () => tarjeta(c, { neta: true }));
      rep(r.int(2, 5), () => cobranzaTrf(c));
      rep(r.int(2, 4), () => pagoTrf(c));
      ajustesSinRegistrar(gastosBancarios(c));
      break;
    case "repetidos": {
      sueldos(c, { n: r.int(3, 8), iguales: true });
      const alquiler = r.cents(400000, 1500000);
      rep(2, () => pagoTrf(c, { monto: alquiler }));
      const cuota = r.cents(50000, 300000);
      rep(r.int(2, 4), () => cobranzaTrf(c, { monto: cuota }));
      rep(r.int(2, 4), () => pagoTrf(c));
      ajustesSinRegistrar(gastosBancarios(c));
      break;
    }
    case "desfasaje":
      rep(r.int(5, 9), () => cobranzaTrf(c, { lag: r.int(0, 12) }));
      rep(r.int(4, 8), () => pagoTrf(c, { lag: r.int(0, 10) }));
      rep(r.int(2, 3), () => debitoAutomatico(c, { adelantoLibro: r.int(0, 15) }));
      ajustesSinRegistrar(gastosBancarios(c));
      break;
    case "consolidados": {
      c.cliente.imp25413 = true; c.cliente.sircreb = r.pick([0.8, 1.5, 2.0]); c.cliente.percepcionIVA = r.chance(0.5);
      rep(r.int(5, 10), () => cobranzaTrf(c));
      rep(r.int(4, 8), () => pagoTrf(c));
      gastosBancarios(c);
      // El cliente asienta a fin de mes un total por concepto.
      const porTipo = {};
      c.B.forEach((m, i) => { if (["impuesto_25413", "retencion_iibb", "comision", "iva_comision", "percepcion_iva"].includes(m.tipo)) (porTipo[m.tipo] ||= []).push(i); });
      const leyenda = { impuesto_25413: "Impuesto ley 25.413 del mes", retencion_iibb: "Retenciones SIRCREB del mes", comision: "Comisiones bancarias del mes", iva_comision: "IVA comisiones bancarias del mes", percepcion_iva: "Percepciones IVA bancarias del mes" };
      for (const [t, idxs] of Object.entries(porTipo)) {
        const tot = idxs.reduce((s, i) => s + c.B[i].cents, 0);
        c.par(idxs, c.l(c.hasta, tot, leyenda[t]), "consolidado");
      }
      break;
    }
    case "tarjetas_brutas":
      rep(r.int(3, 6), () => tarjeta(c, { neta: false }));
      rep(r.int(1, 2), () => tarjeta(c, { neta: true }));
      rep(r.int(2, 4), () => cobranzaTrf(c));
      rep(r.int(2, 4), () => pagoTrf(c));
      ajustesSinRegistrar(gastosBancarios(c));
      break;
    case "errores": {
      rep(r.int(4, 7), () => cobranzaTrf(c));
      rep(r.int(3, 6), () => pagoTrf(c));
      // Importe transpuesto: el libro dice 1.243,50 en vez de 1.234,50.
      const t = pagoTrf(c);
      const L = c.L[t.li]; const s = String(Math.abs(L.cents));
      if (s.length >= 4) { const i = s.length - 4; L.cents = -Number(s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2)); }
      if (L.cents !== c.B[t.bi].cents) {
        c.pares = c.pares.filter((p) => !(p.b.includes(t.bi)));
        c.par(t.bi, t.li, "error_importe");
      }
      // Registro duplicado en el libro.
      const d = pagoTrf(c);
      const dup = c.l(c.L[d.li].fecha, c.L[d.li].cents, c.L[d.li].desc, c.L[d.li].comp);
      c.pendL(dup, "egreso_pendiente");
      creditoNoIdentificado(c);
      debitoNoIdentificado(c);
      // Ingreso registrado hace semanas que el banco nunca acreditó.
      c.pendL(c.l(habil(iso(c.anio, c.mes, r.int(2, 10))), r.cents(50000, 600000), `Cobranza ${r.pick(EMPRESAS)} (depósito)`), "ingreso_no_acreditado");
      ajustesSinRegistrar(gastosBancarios(c));
      break;
    }
    case "volumen":
      c.cliente.imp25413 = true; c.cliente.sircreb = 1.5;
      rep(r.int(60, 110), () => cobranzaTrf(c));
      rep(r.int(40, 80), () => pagoTrf(c));
      rep(r.int(10, 20), () => chequeEmitido(c));
      rep(r.int(5, 10), () => depositoAgrupado(c));
      rep(r.int(3, 6), () => debitoAutomatico(c));
      sueldos(c, { n: r.int(6, 14) });
      rep(2, () => vep(c));
      ajustesSinRegistrar(gastosBancarios(c));
      break;
    default: throw new Error("escenario " + esc);
  }
  // Todo lo solo-banco que no quedó explicado (impuestos/SIRCREB generados por ruido) es ajuste.
  const explicados = new Set([...c.pares.flatMap((p) => p.b), ...c.pend.filter((p) => p.lado === "banco").map((p) => p.i)]);
  c.B.forEach((m, i) => { if (!explicados.has(i)) c.pendB(i, "ajuste_bancario"); });
  return c;
}
