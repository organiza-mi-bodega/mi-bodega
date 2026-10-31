# Mi Bodega — versión 2: comienza desde cero

## Lo nuevo

- Sección **Ubicaciones** para poner nombre a la bodega y a las zonas.
- Zonas predeterminadas A (uso frecuente), B (herramientas), C (temporada), D (objetos grandes) y P (por clasificar).
- Crear más zonas y renombrarlas.
- Registrar cajas por zona, estante (E01), nivel (N01 desde abajo) y orden de izquierda a derecha.
- Registrar **objetos sueltos sin caja** con su propia ubicación.
- Mapa de ubicaciones en tarjetas agrupadas por zona.
- Respaldos JSON versión 2, compatibles al importar respaldos v1.
- Migración IndexedDB v1→v2 sin borrar inventario. Las cajas antiguas que no tenían zona figuran «sin zona asignada».

## Instalación en Windows

1. **Antes de sustituir**, abre la aplicación anterior y entra a Respaldos → Descargar respaldo JSON. Guárdalo fuera de la carpeta.
2. Cierra la pestaña. Extrae el nuevo ZIP y copia **todos los archivos** a la misma carpeta `mi-bodega-app` donde estaba tu aplicación anterior; sustituye los existentes.
3. Si el servidor anterior sigue abierto, déjalo funcionando y pasa al paso 5. Si está cerrado, haz doble clic en `INICIAR_MI_BODEGA.bat`. Alternativamente, abre CMD en esta carpeta y ejecuta `python -m http.server 8000`.
4. Espera a que aparezca «Serving HTTP on … port 8000».
5. Abre http://localhost:8000 y pulsa Ctrl+Shift+R. Si tienes una instalación PWA antigua, cierra y vuelve a abrir.
6. Ve a **Ubicaciones** y personaliza las zonas, luego crea tu primera caja.

**Muy importante:** no cambies de puerto, navegador ni dirección de acceso para conservar el mismo IndexedDB. Por ejemplo `localhost:8000` y `127.0.0.1:8000` pueden tener almacenamiento distinto. Si no aparecen tus datos, usa el respaldo JSON de la versión anterior. Nunca importes un respaldo sin antes exportar tus datos actuales: restaurar REEMPLAZA el inventario.

## Códigos y ejemplo

Bodega principal → Zona B → E01 → N02 → Orden 1 → Caja C001 → objeto posición 1.

Para objetos grandes: Nuevo objeto → Sin caja → Zona D → SUELO → N00 → posición 1.

El número de la caja nunca cambia aunque se mueva; el código QR sigue siendo válido. La lectura con cámara depende de compatibilidad con BarcodeDetector.

## Almacenamiento

Todo sigue guardado solo en IndexedDB en tu navegador. Sin login, sin servidor de datos, sin sincronización. Haz respaldos JSON regulares.

---

# Mi Bodega · aplicación de inventario (MVP)

Una aplicación web instalable (PWA) en español, construida con HTML, CSS y JavaScript sin dependencias de red. Incluye:

- Cajas con identificador único C001, C002… y ubicación bodega / estante / nivel / orden.
- Objetos con cantidad, categoría, fotografía opcional, notas, caja y posición.
- Búsquedas por nombre y ubicación.
- Etiquetas QR imprimibles; el QR contiene `MI-BODEGA|C001`, por ejemplo.
- Escaneo por cámara con BarcodeDetector donde esté disponible, con búsqueda manual en otros navegadores.
- Exportación JSON (incluidas fotos), importación JSON y exportación CSV para Excel.
- Almacenamiento local IndexedDB y funcionamiento sin conexión después de la primera carga.

## Ejecutarla en un computador

1. Descomprime el ZIP y abre una terminal en la carpeta `mi-bodega-app`.
2. Ejecuta `python -m http.server 8000` (requiere Python 3). Otra opción: `npx http-server`, si lo tienes instalado.
3. En el navegador abre **http://localhost:8000**.
4. Ve a **Respaldos > Cargar datos de ejemplo** para probar, o crea tus propias cajas.
5. Usa **Respaldos > Descargar respaldo JSON** periódicamente y guárdalo en otro lugar.

## Instalarla en el teléfono Android

Publica *esta misma carpeta* en un hosting estático con **HTTPS** (por ejemplo GitHub Pages o Cloudflare Pages). Abre la URL desde Chrome Android y elige **Instalar aplicación** o **Agregar a pantalla principal**, según el navegador. Una vez instalada, puedes usarla sin conexión (después de la primera visita en línea).

**Importante:** esta primera versión tiene datos **locales por dispositivo y navegador**. Por lo tanto, lo que registres en el computador NO aparece automáticamente en el celular: puedes exportar un JSON desde uno e importarlo en otro. Para sincronización real, agrega un backend autenticado, por ejemplo Supabase con PostgreSQL y políticas de acceso RLS.

**QR:** se generan offline y el lector integrado necesita navegador compatible y HTTPS / localhost. El QR solo contiene el ID de la caja; no hace referencia a una URL pública. Al escanearlo con un lector QR externo no abrirá el inventario automáticamente: utiliza **Escanear QR** dentro de Mi Bodega, o busca la caja por su código.

## Cómo distribuir físicamente tu bodega

Ejemplo de una ficha:

- Bodega: `Bodega principal`
- Estante: `E2`
- Nivel: `3`
- Orden de caja en nivel: `2`
- Código: `C005`
- Objeto: `Luces de Navidad`
- Posición dentro de caja: `1`

Pega la etiqueta QR en el frente de cada caja y anota el orden físico de izquierda a derecha.

## Archivos

- `index.html`: interfaz y formularios.
- `styles.css`: estilos adaptables a pantallas móviles.
- `app.js`: lógica, inventario, validación, IndexedDB, importación / exportación y cámara.
- `qr-engine.js`: motor QR local sin conexión.
- `sw.js`: caché para uso sin conexión.
- `manifest.webmanifest`: configuración instalable.
- `assets`: iconos.

## Límites y seguridad

Es una **versión inicial personal**, no una solución de producción multiusuario. No cuenta con usuarios, claves, sincronización o backups automáticos. Protege el teléfono o computador con bloqueo de pantalla, evita dispositivos compartidos y no publiques respaldos que contengan fotos o inventarios sensibles. Los datos del navegador se pueden perder si borras datos del sitio o cambias de origen (dominio/puerto). Al usar navegación privada, el almacenamiento puede no persistir. La importación JSON reemplaza todos los datos actuales, después de solicitar confirmación.

Licencias para el motor QR en `LICENSE-QR.txt`.
