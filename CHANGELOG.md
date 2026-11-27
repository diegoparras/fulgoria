# Changelog

Todos los cambios de Fulgoria que se notan, de la version mas nueva a la mas vieja.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y
[Versionado Semantico](https://semver.org/lang/es/). Cada deploy sube la version y agrega su
seccion aca: sin ella el CI no publica la imagen.

## [1.1.0] - 2026-11-27

### Nuevo
- **Conciliar con el mayor** (menu, o `/conciliar`): se sueltan el extracto y el mayor de la
  cuenta Banco y Fulgoria los lee, verifica los saldos, empareja y muestra solo lo que necesita
  una decision. Semaforo en cada partida (verde solo si esta probado), "por que" de cada
  emparejamiento, pendientes clasificados (cheques, depositos en transito, creditos sin
  identificar), asientos de ajuste listos para importar, papel de trabajo (Markdown y CSV), pedido
  al cliente armado y "Ver en el extracto" con la fila marcada en el PDF.
- **Modo automatico y modo deportivo**: el deportivo suma todos los mandos del motor en vivo
  (ventanas de fechas, tolerancia, agrupados, % de pago a cuenta del impuesto al cheque, plan de
  cuentas) y una mesa para emparejar a mano.
- **Ruido fiscal argentino**: impuesto ley 25.413 (con control del 0,6% y pago a cuenta), SIRCREB,
  percepciones, comisiones con su IVA, intereses, VEP, tarjetas y Mercado Pago se reconocen solos.
- **Columnas del mayor**: si no se reconocen, se indican una vez con vista previa y quedan como
  plantilla del sistema contable.
- **Modo estudio** (`PERSISTENCIA=on`): clientes, cuentas y meses guardados en el servidor del
  estudio o en un bucket **R2 / S3 / MinIO**, con cifrado de documentos (`DOCS_CLAVE`), copias de
  la base, arrastre automatico de pendientes al mes siguiente, estados borrador / preparado /
  revisado / cerrado, tablero de cartera, plantillas compartidas y registro de auditoria.
- **Roles**: lector, preparador, revisor y admin. Standalone (el admin del .env da de alta a los
  usuarios) o federado con **Lockatus** (el rol viene del hub; `LOCKATUS_ROLES` traduce nombres).
  Opcional: `REVISION_INDEPENDIENTE=on` (quien prepara no revisa).
- **IA para bancos nuevos** (`IA_PROVEEDOR`: Claude, OpenAI, OpenRouter o un modelo local): si
  un extracto no se lee bien, la IA propone las columnas a partir de un esqueleto anonimo (sin
  nombres, montos ni cuentas) y la regla del saldo decide; si cierra, queda la plantilla del banco.
- **Dataset sintetico de conciliacion** (148 casos con la respuesta correcta) y benchmark, para
  medir el lector y el motor; generador de casos a partir de la plantilla de un banco real.

### Cambiado
- **Extractor**: rol nuevo "Signo (D/H)", saldo inicial y final tomados de los rotulos cuando el
  banco no imprime saldo corrido, fechas sin año, y auto-deteccion verificada por la regla del
  saldo (prueba varias lecturas y se queda con la que cierra). Las plantillas que se guardan quedan
  tambien para todo el estudio si el modo estudio esta activo.

### Seguridad
- Los documentos guardados se devuelven solo con tipos conocidos (PDF, CSV, imagenes, planillas) y
  con una politica que impide ejecutarlos: el tipo que manda quien sube el archivo ya no se respeta.
- La pantalla Conciliar escapa todo lo que viene del servidor (semaforo del tablero, fechas y filas
  de los pendientes arrastrados, mandos de la cuenta) y el servidor valida la forma del resumen, de
  los pendientes y de los mandos. Cerraba un camino para que un preparador ejecutara codigo en la
  sesion de un admin.

## [1.0.1] - 2026-11-20

### Nuevo
- **Cada deploy dice su version y que cambia.** Lo primero que escribe el contenedor al
  levantar (los registros del servicio en EasyPanel) es un cartel con la version y las
  novedades de este CHANGELOG.
- **Aviso de novedades en la interfaz**: al entrar despues de una actualizacion aparece
  "Novedades" con todo lo que cambio desde la ultima version vista en ese navegador (una sola
  vez). El historial queda a mano en el menu, **Novedades**, y en **Acerca de
  Fulgoria**, con el enlace "Que cambio".
- **Imagen etiquetada con la version** (`:1.0.1`, ademas de `:latest`) y Release `v1.0.1` en
  GitHub con estas mismas notas.

### Cambiado
- La imagen corre sobre **Node 24 LTS** (antes Node 20), fijada por digest para builds
  reproducibles.
