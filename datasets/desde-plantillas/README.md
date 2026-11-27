# Casos generados desde plantillas de bancos

Cada carpeta es un dataset con el mismo formato que `datasets/conciliacion-sintetica/` (ver su
README), generado con el **diseño** de un banco a partir de una plantilla de Fulgoria:

```bash
node tools/dataset/gen.mjs --plantilla <banco>.ext.json --semillas 3
node tools/dataset/bench.mjs --dir datasets/desde-plantillas/<banco>
```

La plantilla guarda la forma del extracto (columnas, posiciones, rótulos, formatos), nunca sus datos:
los movimientos, titulares y cuentas de estos casos son ficticios.

| Carpeta | Plantilla | Casos |
|---|---|---:|
| `banco-del-rio/` | `samples/plantillas/banco-del-rio.ext.json` | 20 |
