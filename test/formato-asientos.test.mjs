// Formato de asientos aprendido de un ejemplo: el contador sube un archivo de importación que su
// sistema acepta y Fulgoria genera los asientos con esa misma forma. Se prueba con cinco ejemplos
// bien distintos (Excel con fila de cabecera, TXT tabulado, ancho fijo, CSV con D/H y con signo).
import test from "node:test";
import assert from "node:assert/strict";
import { leerEjemplo, aprenderFormato, generarArchivo, describirFormato } from "../src/core/formato-asientos.js";
import { escribirXlsx } from "../src/core/xlsx-escribir.js";
import { leerXlsx } from "../src/core/xlsx.js";

const ajustes = [
  { fecha: "2026-06-05", concepto: "Impuesto ley 25.413", origen: ["B3"], lineas: [{ cuenta: "5.2.01 Impuesto débitos y créditos", debe: 1650, haber: 0 }, { cuenta: "1.1.2.01 Banco Río", debe: 0, haber: 1650 }] },
  { fecha: "2026-06-05", concepto: "Comisión", origen: ["B5"], lineas: [{ cuenta: "5.2.02 Gastos bancarios", debe: 450000, haber: 0 }, { cuenta: "1.1.2.01 Banco Río", debe: 0, haber: 450000 }] },
  { fecha: "2026-06-30", concepto: "Intereses", origen: ["B9"], lineas: [{ cuenta: "1.1.2.01 Banco Río", debe: 11200, haber: 0 }, { cuenta: "4.3.01 Intereses ganados", debe: 0, haber: 11200 }] },
];
const te = new TextEncoder();
const aprender = async (nombre, bytes) => aprenderFormato(await leerEjemplo(nombre, bytes), { nombre });
const texto = (out) => new TextDecoder(out.bytes[0] === 0xef ? "utf-8" : "windows-1252").decode(out.bytes);
const roles = (f) => f.columnas.map((c) => c.rol);

test("Excel con fila de cabecera por asiento, cuentas por nombre y un valor fijo", async () => {
  const f = (d) => ({ fecha: d });
  const ejemplo = escribirXlsx([{ nombre: "Hoja1", filas: [
    ["FECHA", "CONCEPTO", "CIRCUITOCONTABLE", "CUENTA", "DEBE", "HABER", "ORGANIZACION", "CENTRODECOSTO", "DESCRIPCION"],
    [f("2018-01-01"), "Asiento inicial clientes", "default"], [null, null, null, "Deudores por Venta", 1210, null, "Cliente Ejemplo S.A."], [null, null, null, "Venta de Bienes", null, 1000], [null, null, null, "IVA Débito Fiscal", null, 210],
    [f("2018-01-02"), "Retiro de fondos", "default"], [null, null, null, "Caja", 5000, null, null, "Comercialización"], [null, null, null, "Banco", null, 5000, null, "Comercialización"],
  ] }]);
  const fmt = await aprender("modelo.xlsx", ejemplo);
  assert.equal(fmt.estructura, "cabecera");
  assert.deepEqual(roles(fmt), ["fecha", "concepto", "fijo", "cuenta", "debe", "haber", "vacio", "vacio", "detalle"]);
  assert.equal(fmt.columnas[2].valor, "default");
  assert.equal(fmt.cuenta.modo, "nombre");
  // No guarda datos del ejemplo (salvo el valor fijo y los títulos).
  assert.ok(!/Deudores|Cliente Ejemplo|Caja|1210/.test(JSON.stringify(fmt)));
  const { hojas } = await leerXlsx(generarArchivo(fmt, ajustes).bytes);
  assert.deepEqual(hojas[0].rows[0], ["FECHA", "CONCEPTO", "CIRCUITOCONTABLE", "CUENTA", "DEBE", "HABER", "ORGANIZACION", "CENTRODECOSTO", "DESCRIPCION"]);
  assert.deepEqual(hojas[0].rows[1].slice(0, 4), ["05/06/2026", "Impuesto ley 25.413", "default", ""]);
  assert.deepEqual(hojas[0].tipos[1][0], "fecha"); // fecha real de Excel, como en el ejemplo
  assert.deepEqual(hojas[0].rows[2].slice(3, 6), ["Impuesto débitos y créditos", "16.5", ""]);
  assert.equal(hojas[0].tipos[2][4], "numero");
});

test("TXT tabulado sin títulos: fecha, asiento, código de cuenta, Debe, Haber, concepto y leyenda", async () => {
  const ej = ["05/06/2026\t0001\t1.1.1.05.100\t1980,00\t0,00\tCobro Factura A-0001-0001544\tS/Recibo Nro. 1488", "05/06/2026\t0001\t4.1.1.01\t0,00\t1980,00\tCobro Factura A-0001-0001544\tS/Recibo Nro. 1488",
    "05/06/2026\t0002\t5.2.1.03\t150,50\t0,00\tGastos bancarios\tResumen junio", "05/06/2026\t0002\t1.1.1.05.100\t0,00\t150,50\tGastos bancarios\tResumen junio"].join("\n") + "\n";
  const fmt = await aprender("asientos.txt", te.encode(ej));
  assert.deepEqual(roles(fmt), ["fecha", "asiento", "cuenta", "debe", "haber", "concepto", "detalle"]);
  assert.equal(fmt.cuenta.modo, "codigo");
  const lineas = texto(generarArchivo(fmt, ajustes)).trimEnd().split("\n").map((l) => l.split("\t"));
  assert.deepEqual(lineas[0], ["05/06/2026", "0001", "5.2.01", "16,50", "0,00", "Impuesto ley 25.413", "Impuesto ley 25.413"]);
  assert.deepEqual(lineas[2].slice(1, 5), ["0002", "5.2.02", "4500,00", "0,00"]);
  assert.match(describirFormato(fmt).join(" "), /tabulación/);
});

test("Ancho fijo con importe y D/H pegados, fecha AAAAMMDD y códigos sin puntos", async () => {
  const ej = "20260605 000001 1110510        1980.00D Cobro factura 1544\r\n20260605 000001 4110100        1980.00H Cobro factura 1544\r\n20260610 000002 5210300         150.50D Gastos bancarios\r\n20260610 000002 1110510         150.50H Gastos bancarios\r\n";
  const fmt = await aprender("asientos.dat", te.encode(ej));
  assert.equal(fmt.archivo.tipo, "fijo");
  assert.deepEqual(roles(fmt), ["fecha", "asiento", "cuenta", "importeDH", "concepto"]);
  assert.equal(fmt.fecha.patron, "AAAAMMDD");
  const out = texto(generarArchivo(fmt, ajustes)).split("\r\n");
  assert.equal(out[0], "20260605 000001 5201             16.50D Impuesto ley 25.413");
  assert.equal(out[2], "20260605 000002 5202           4500.00D Comisión");
  // Las columnas quedan en las mismas posiciones que el ejemplo.
  assert.equal(out[2].indexOf("D Comisión"), ej.indexOf("D Cobro"));
});

test("CSV con D/H en otra columna, títulos y UTF-8; CSV con importe con signo", async () => {
  const dh = "Fecha;Asiento;Cuenta;Leyenda;D/H;Importe\n05/06/2026;15;Banco Galicia cta cte;Cobro cliente;D;1.980,00\n05/06/2026;15;Deudores por ventas;Cobro cliente;H;1.980,00\n10/06/2026;16;Gastos bancarios;Comisión;D;150,50\n10/06/2026;16;Banco Galicia cta cte;Comisión;H;150,50\n";
  const f1 = await aprender("dh.csv", te.encode(dh));
  assert.deepEqual(roles(f1), ["fecha", "asiento", "cuenta", "detalle", "signo", "importe"]);
  const l1 = new TextDecoder().decode(generarArchivo(f1, ajustes).bytes).split("\n");
  assert.equal(l1[0], "Fecha;Asiento;Cuenta;Leyenda;D/H;Importe");
  assert.equal(l1[3], "05/06/2026;2;Gastos bancarios;Comisión;D;4.500,00");

  const signo = 'fecha,cuenta,importe,descripcion\n2026-06-05,111001,1980.00,"Cobro, cliente"\n2026-06-05,411001,-1980.00,"Cobro, cliente"\n';
  const f2 = await aprender("signo.csv", te.encode(signo));
  assert.deepEqual(roles(f2), ["fecha", "cuenta", "importeConSigno", "detalle"]);
  const l2 = texto(generarArchivo(f2, ajustes)).split("\n");
  assert.equal(l2[1], "2026-06-05,5201,16.50,Impuesto ley 25.413");
  assert.equal(l2[2], "2026-06-05,11201,-16.50,Impuesto ley 25.413");
});

test("ejemplos que no sirven: vacío o .xls viejo", async () => {
  await assert.rejects(leerEjemplo("x.txt", te.encode("\n\n")), /vacío/);
  await assert.rejects(leerEjemplo("x.xls", te.encode("abc")), /\.xls/);
});
