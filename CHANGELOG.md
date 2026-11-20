# Changelog

Todos los cambios de Fulgoria que se notan, de la version mas nueva a la mas vieja.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y
[Versionado Semantico](https://semver.org/lang/es/). Cada deploy sube la version y agrega su
seccion aca: sin ella el CI no publica la imagen.

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
