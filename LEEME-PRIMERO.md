# MI BODEGA 3.0 — Celular y computador (PWA)

Esta versión prepara la aplicación para **instalarla en el teléfono Android** y usarla también desde un computador con **la misma cuenta y el mismo inventario**. No es una APK. Es una **PWA** instalable desde Chrome/Edge. Incluye actualizaciones del código cuando se publica una versión nueva en el mismo sitio HTTPS y sincronización opcional con Supabase.

## Estado real

- **Ya implementado:** interfaz adaptable a celular; manifest + íconos; servicio de actualización y caché para usarla sin internet tras la primera visita; preservación de la base local IndexedDB; JSON/CSV de respaldo; formularios de cajas/objetos; escaneo QR donde el navegador lo admita; conexión a Supabase mediante email/contraseña; RLS y control de versiones de inventario; protección ante sobrescrituras simultáneas.
- **Pendiente de configurar por la dueña:** tener un proyecto Supabase propio, crear la tabla con `supabase.sql`, publicar en una dirección HTTPS (GitHub Pages, Netlify, Cloudflare Pages u otro hosting), configurar la URL y clave publicable del proyecto.
- **No hecho:** no se ha creado ni desplegado un servidor en nombre de la usuaria; la sincronización en vivo no ha sido probada contra un proyecto Supabase real porque faltan esas credenciales. La app NO se actualiza desde este ZIP en el PC sin publicarla. El QR integrado depende del navegador; existe búsqueda manual alternativa.

## 1. Antes de actualizar: conservar TODO lo anterior

1. Abre la versión antigua (v1/v2) en **el mismo navegador y `http://localhost:8000`**.
2. Ve a **Respaldos → Descargar respaldo JSON**. Copia el archivo `.json` a otra carpeta de tu PC, idealmente también a otro disco.
3. Cierra las pestañas de Mi Bodega.
4. Descomprime `mi-bodega-v3.zip`; copia **todos los archivos del interior de `mi-bodega-v3`** a la carpeta que sirves con Python en `localhost:8000` y reemplaza los archivos anteriores. **No borres otros archivos de respaldo.**
5. Abre CMD en esa carpeta y ejecuta `python -m http.server 8000`. En Chrome abre `http://localhost:8000` y usa Ctrl+Shift+R. Mantén el mismo navegador, protocolo, dominio y puerto para reutilizar IndexedDB.
6. Confirma que aparecen tus cajas y objetos y que sigue funcionando la exportación de JSON.

**Nunca borres los datos del navegador ni la carpeta antigua hasta comprobar el traslado a HTTPS.** Publicar en otro dominio genera un IndexedDB nuevo; para pasarlo a la nueva URL debes exportar el JSON desde localhost e importarlo en la nueva URL.

## 2. Crear el almacenamiento seguro en la nube

1. Crea una cuenta en https://supabase.com y un proyecto nuevo (puedes utilizar el plan gratuito sujeto a sus límites).
2. En el panel del proyecto, abre **SQL Editor**, pega el contenido de `supabase.sql`, ejecútalo una vez.
3. En **Project Settings > API Keys** copia la **publishable key** (`sb_publishable_...`) o la clave `anon` heredada. **Jamás copies `service_role` ni claves secretas en HTML/JS.**
4. Copia la URL principal del proyecto `https://...supabase.co` desde Project Settings.
5. Para evitar escribir la configuración en cada equipo, edita `cloud-config.js` **antes de publicarlo**, así:

   `window.MI_BODEGA_CLOUD = { url: 'https://TU-PROYECTO.supabase.co', publishableKey: 'sb_publishable_TU_CLAVE_PUBLICA' };`

   Esta clave es **pública** por diseño; los datos quedan protegidos por las políticas RLS del archivo SQL. Si no editas ese archivo, introduce URL/clave desde **Respaldos → Configurar base de datos** en cada dispositivo.
6. Asegúrate de habilitar el proveedor de inicio de sesión **Email** en **Authentication > Providers**. Si habilitas confirmación por correo, la aplicación te pedirá confirmar tu email antes de iniciar sesión; Supabase requiere servicio de envío válido y puede limitar los correos que envía con su servicio predeterminado.
7. En **Respaldos** crea tu cuenta o inicia sesión con correo y contraseña; usa siempre la **misma cuenta** en el celular y el PC. Si ya había datos locales y datos en nube, la app te pide elegir; descarga las copias antes de sobrescribir nada.

## 3. Publicar la aplicación e instalarla en el celular

Puedes usar una web estática HTTPS. Ejemplo con GitHub Pages:

1. Crea un repositorio nuevo en GitHub (público si usas GitHub Pages del plan gratuito). No subas contraseñas ni claves secretas.
2. Sube **los archivos internos de la carpeta** `mi-bodega-v3` (`index.html`, `app.js`, `sync.js`, `sw.js`, `cloud-config.js`, `styles.css`, `manifest.webmanifest`, `assets/`, etc.). `index.html` debe quedar en la raíz del sitio que se publica.
3. En tu repositorio elige **Settings → Pages → Deploy from a branch → main → / (root)** (según interfaz y plan). Espera a que se publique la URL HTTPS que te muestre GitHub.
4. Desde Android abre esa URL HTTPS en Chrome → menú ⋮ → **Instalar aplicación** (o **Agregar a pantalla principal**). En PC abre la misma URL en Chrome o Edge y selecciona el icono Instalar.
5. Inicia sesión con la misma cuenta en ambos dispositivos. En el PC anterior exporta el JSON; en la versión HTTPS impórtalo **solo si el inventario remoto está vacío** o, si ya hay dos versiones, sigue las instrucciones en pantalla para elegir qué conservar.

### Actualizaciones automáticas

Cuando publiques **una versión nueva en la MISMA URL HTTPS** y cambies el identificador `CACHE_NAME` de `sw.js`, los dispositivos buscarán actualizaciones al abrir/recuperar foco y cada 15 minutos mientras la app esté abierta. El service worker descarga los archivos de la nueva versión; la aplicación recarga automáticamente **si no hay un formulario en edición**. Si estabas editando, mostrará un aviso para actualizar al cerrar el formulario. El teléfono debe conectarse a internet para recibir versiones nuevas.

**Publicar una nueva versión sigue siendo una acción necesaria:** no existe una actualización mágica desde tu PC si los archivos del sitio web no cambian.

## 4. Cómo se conservan los datos

- Las versiones de código se descargan a la caché de la PWA. **Tus cajas, fotos y objetos viven en IndexedDB**, que no se borra por renovar la caché. La base de la app conserva su nombre original `mi-bodega-local-v1` y se amplía a DB_VERSION 3 sin borrar tablas.
- Con Supabase configurado, cada cambio se marca como pendiente y se envía automáticamente al servidor cuando hay internet y sesión válida; un dispositivo nuevo descarga la copia del servidor.
- La nube usa **control de versión por inventario** y reglas RLS por usuario. Si cambias el inventario en dos dispositivos sin sincronizar, se bloquea la sobrescritura automática y verás opciones para escoger una copia. Las dos versiones se pueden descargar antes de reemplazar.
- **Esto no garantiza copia indestructible:** un borrado en línea puede propagarse; los conflictos requieren atención; los límites de tamaño y los servicios externos pueden fallar. Descarga además respaldos JSON periódicos y consérvalos en otra ubicación. Para protección profesional, crea también backups programados de la base Supabase según tu plan.
- Si cierras sesión en un dispositivo compartido, el inventario **sigue en la copia local**; utiliza dispositivos personales protegidos con PIN/huella, o planifica un modo de borrado seguro local antes de compartir el dispositivo.

## 5. Comprobar que realmente funciona

1. En el PC, en la URL HTTPS, crea la caja `C001` y un objeto; espera el texto verde **«Sincronizado»** en Respaldos.
2. En Android, inicia sesión con la misma cuenta, espera conexión y comprueba que aparece la misma caja.
3. En Android crea `C002`, espera confirmación. En el PC cambia a otra pestaña y regresa, o pulsa **Sincronizar ahora**. Comprueba que aparece `C002`.
4. Desconecta el internet del teléfono; registra otro objeto. Comprueba que el inventario aparece local. Restablece internet, abre la app, espera el estado **«Sincronizado»** y verifica en PC.
5. Haz **Respaldos → Descargar respaldo JSON** en el PC y prueba restaurarlo con cuidado en un perfil de navegador distinto y desconectado de la nube.
6. Para probar una nueva versión de código, cambia `CACHE_NAME` y publica el nuevo `sw.js` y archivos; abre la aplicación con internet y comprueba el aviso o recarga, sin pérdida del inventario.

## Limitaciones y seguridad

- Esta versión sincroniza **un inventario completo por cuenta**, no ediciones granulares. Dos usuarios editando simultáneamente pueden encontrarse con conflictos; no se mezclan automáticamente.
- Guarda sesión de Supabase en el navegador, como muchas aplicaciones web; utiliza HTTPS, contraseñas seguras y no compartas equipos. No almacena contraseñas, pero el token de sesión permanece en `localStorage` hasta el cierre de sesión.
- No introduzcas información extremadamente sensible como contraseñas o documentos de identidad en notas del inventario.
- Fotos del inventario se guardan en el JSON; una cantidad muy grande de fotos puede sobrepasar el tamaño permitido de peticiones o la cuota de base de datos de tu plan. En ese caso, la siguiente evolución sería guardarlas en Supabase Storage de forma separada.
- El HTML/JS se publica como código estático; la privacidad de los registros depende de autenticar y mantener la RLS activada en Supabase.
