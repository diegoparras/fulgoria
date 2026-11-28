# Changelog

Todos los cambios de Fulgoria que se notan, de la version mas nueva a la mas vieja.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y
[Versionado Semantico](https://semver.org/lang/es/). Cada deploy sube la version y agrega su
seccion aca: sin ella el CI no publica la imagen.

## [1.4.0] - 2026-11-28

### Nuevo
- **Excel (.xlsx)** en Conciliar, para el mayor y para el extracto, sin pasar por CSV. Fulgoria
  decide sola si una planilla es el mayor, un extracto bancario exportado o el reporte de Mercado
  Pago; si es ambigua (solo "Debito / Credito", que significan cosas opuestas en un extracto y en un
  mayor) la lee de las dos maneras y se queda con la que hace cerrar los saldos. Si aun asi no puede
  saberlo, un boton la cambia de lugar.
- **Mercado Pago**: reportes de liberaciones y de dinero en cuenta (CSV o Excel). Saldo inicial,
  neto por operacion con bruto, comision y retenciones a la vista, y percepciones, retenciones,
  retiros e intereses traducidos para que el clasificador los proponga como asientos.
- **Link de respuesta del cliente**: desde "Pedir al cliente" se crea un link para que el cliente
  conteste que es cada movimiento, sin cuenta ni contrasena, desde el celular. Las respuestas
  aparecen en la bandeja junto a cada partida. Ve solo esas partidas, vence a los 30 dias y se puede
  anular.
- **Asientos en el formato de tu sistema contable, aprendido de un ejemplo**: en "Descargar
  asientos" se sube un archivo de importacion que el sistema acepta (Excel, CSV o TXT, con
  separadores o de ancho fijo) y Fulgoria aprende la forma: columnas, fechas, importes, cuentas,
  numeracion y si cada asiento lleva cabecera. Se revisa y corrige con una vista previa de los
  asientos del mes, se guarda con el nombre que uno quiera y se comparte con el estudio. No guarda
  ningun dato del ejemplo.
- **Formatos ya armados para Xubio y Holistor**, tomados de su documentacion oficial. En el plan de
  cuentas se puede escribir "codigo nombre": cada formato toma el codigo o el nombre segun pida.
- **Restaurar copias de la base**: `node server.js --copias` y `node server.js --restaurar <copia>`.
- Planillas de ejemplo en `datasets/planillas` (banco en Excel, Mercado Pago, planilla ambigua).

### Seguridad
- Los pedidos que cambian algo en la API tienen que venir de la misma pagina (control de `Origin`):
  se rechazan los que vienen de otro sitio.
- Los tests corren en GitHub en cada pull request.

## [1.3.1] - 2026-11-27

### Cambiado
- **Automatico / Deportivo**: el modo elegido se distingue por color: Automatico en el azul de
  Fulgoria y Deportivo en rojo aventura, los dos con texto blanco.

### Arreglado
- **Estilos de la version anterior despues de un deploy**: las paginas piden sus estilos y scripts
  con el numero de version (`app.css?v=1.3.1`). Un navegador o un proxy que guardo el CSS viejo ya
  no lo mezcla con la pagina nueva (por eso en 1.3.0 el modo elegido podia verse en blanco).

## [1.3.0] - 2026-11-27

### Cambiado
- **Un solo header en todas las pantallas**: logo (lleva al inicio), "Fulgoria" y la seccion en
  gris (**Fulgoria Conciliar**, **Fulgoria Extractor**; en la portada, solo "Fulgoria"), los
  controles de la seccion a la derecha y el mismo menu ⋮ en todas: secciones (Inicio, Conciliar,
  Extractor), idioma, tema, novedades, "Acerca de" y salir. En Conciliar ya no hay un boton
  "Extractor" suelto ni el del tema: estan en el menu, igual que en el resto.
- **Automatico / Deportivo**: el elegido se ve en el azul de Fulgoria, con texto blanco; tambien
  se cambia con las flechas del teclado.
- **Extractor**: al abrir un documento la portada se hace a un lado y queda el trabajo arriba de
  todo. Se llega tambien desde el menu (Secciones > Extractor), con su propia tarjeta para
  soltar el extracto, igual a la de Conciliar.
- **Diseno unificado**: las mismas tarjetas, zonas para soltar archivos, botones y ventanas en
  las dos pantallas, en claro, oscuro y celular. Cada seccion tiene su matiz (petroleo en
  Conciliar, indigo en el Extractor) en su icono y en su zona principal.

### Corregido
- Todo campo de contrasena tiene el boton para mostrarla u ocultarla (clave de API de la IA,
  alta de usuarios y nueva contrasena, que antes se veia en claro).
- Los titulos de las ventanas de Conciliar salian chicos y en azul.
- En tema oscuro, el boton del login usaba otro azul y se leia mal.

## [1.2.1] - 2026-11-27

### Corregido
- Despues de un deploy el navegador podia seguir usando el codigo anterior hasta una hora (por
  ejemplo, no aparecia el boton **IA** en Conciliar). Ahora el codigo de la app se revalida siempre.
- En modo estudio, la pantalla Conciliar ya no dice "Nada sale de tu computadora": dice que los
  documentos se guardan en el servidor del estudio (cifrados, si corresponde).

## [1.2.0] - 2026-11-27

### Nuevo
- **IA configurable por el admin** (Conciliar → IA): se elige **Sin IA**, **IA local** (Ollama, LM
  Studio, vLLM: nada sale del estudio) o **IA externa** (Claude, OpenAI, **Gemini** u OpenRouter),
  y cada opcion muestra lo que tiene configurado. Se guardan las dos configuraciones, asi que se
  pasa de una a otra sin volver a cargar nada; lo que ya este en el `.env` aparece precargado.
  Modelo con la lista de los que habilita el servidor o la clave, URL y temperatura opcionales,
  boton **Probar** antes de guardar. La clave queda cifrada con `DOCS_CLAVE` y no vuelve a
  mostrarse. Lo elegido manda sobre el `.env` ("Sin IA" la apaga aunque el `.env` tenga una);
  **Volver al .env** lo borra.
- **Modelos que no aceptan temperatura** (los de razonamiento de OpenAI como GPT-6 Luna, los Claude
  actuales): si el proveedor la rechaza, se reintenta sin ella y se recuerda para ese modelo. A las
  APIs compatibles con OpenAI ya no se les manda `max_tokens`.

### Cambiado
- **Portada nueva**: la conciliacion pasa al frente ("Conciliaciones bancarias que se hacen solas")
  con un boton directo a Conciliar; el extractor queda como segunda opcion. En los 7 idiomas.

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
