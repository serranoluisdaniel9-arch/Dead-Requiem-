# Plan de Implementación: Corrección de Cámara Anti-Paredes (Pantalla Azul) y Empaquetado APK

## 1. Causa Raíz Identificada del Problema de la "Pantalla Azul"
- **Fondo y niebla azul:** `scene.background` y `scene.fog` en Three.js están configurados como `#101822` (azul marino/cian oscuro).
- **Inexistencia de colisión de cámara:** La función `updateCamera()` en tercera persona calcula la posición de la cámara retrocediendo una distancia fija (`-(2.8 - .55 * aimBlend)`) desde el pivote de Valeria.
- **Traspaso de mallas y culling de caras traseras:** Cuando el jugador retrocede, gira cerca de una pared, esquina o barricada, la cámara se posiciona dentro o detrás de la geometría. Como las mallas de los edificios usan descarte de caras traseras (*backface culling*), los muros se vuelven invisibles desde adentro, dejando expuesto exclusivamente el fondo azul marino del motor (`#101822`), cubriendo por completo la vista del juego.

---

## 2. Solución Técnica Propuesta

### Fase 1: Sistema de Colisión de Cámara Spring-Arm (Brazo Elástico con Raycast)
- Implementar un trazado de colisión desde `cameraPivot` hacia la posición deseada de la cámara (`desiredCamera`).
- Evaluar intersecciones contra todos los volúmenes del escenario (`obstacles`, edificios, farolas y barricadas) considerando un margen de seguridad (*clearance radius*) de al menos `0.35m`.
- Si se detecta un impacto, ajustar dinámicamente la distancia del brazo retráctil para posicionar la cámara justo delante de la superficie colisionada, evitando que penetre cualquier geometría.
- Suavizar la transición con interpolación (`lerp`) para evitar tirones abruptos cuando Valeria pasa cerca de postes o esquinas.

### Fase 2: Ajuste de Planos de Recorte y Renderizado de Respaldo
- Configurar el plano de recorte cercano (`near clipping plane`) de la cámara a `0.08` para evitar que mallas cercanas a Valeria queden cortadas prematuramente.
- Garantizar que los límites perimetrales del distrito impidan que el pivote del jugador se acerque a zonas fuera del mapa transitable.

### Fase 3: Verificación Visual y de Rendimiento
- Probar el movimiento del personaje en 360 grados, retrocediendo hacia muros altos, esquinas y barricadas para confirmar que la pantalla azul nunca aparece.
- Validar que los controles táctiles, apuntado, disparo y animaciones sigan funcionando al 100%.

### Fase 4: Compilación y Firma de APK Nativo con Gradle
- Compilar el proyecto Android nativo con `compile_applet` y Gradle (`assembleDebug`).
- Verificar que el APK contenga todos los assets y scripts actualizados y esté listo para su instalación directa.
