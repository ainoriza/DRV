# INASE · Gestión de Variedades — Frontend

SPA para GitHub Pages que consume la API REST en Google Apps Script.

---

## 📁 Estructura

```
inase-app/
├── index.html   ← Estructura HTML + shell de la app
├── app.js       ← Lógica SPA (login, fetch, tabla, formularios)
├── styles.css   ← Estilos (complementa Tailwind CDN)
└── README.md
```

---

## 🚀 Deploy en GitHub Pages

1. Creá un repositorio público en GitHub (ej: `inase-frontend`).
2. Subí los tres archivos (`index.html`, `app.js`, `styles.css`).
3. En **Settings → Pages → Source** → seleccioná `main` branch, carpeta `/root`.
4. Tu app quedará en `https://TU-USUARIO.github.io/inase-frontend/`.

---

## 🔧 Configuración (en `app.js`)

Editá el bloque `CONFIG` al inicio de `app.js`:

```js
const CONFIG = {
  API_URL: "https://script.google.com/macros/s/TU_DEPLOYMENT_ID/exec",
  GOOGLE_CLIENT_ID: "TU_CLIENT_ID.apps.googleusercontent.com",
};
```

---

## 🔐 Configurar Google Login

### 1. Google Cloud Console
1. Entrá a https://console.cloud.google.com → seleccioná tu proyecto.
2. Ir a **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**.
3. Tipo: **Web application**.
4. En **Authorized JavaScript origins** agregá:
   - `http://localhost` (para desarrollo local)
   - `https://TU-USUARIO.github.io` (tu dominio de GitHub Pages)
5. En **Authorized redirect URIs** NO hace falta agregar nada (Google Identity Services usa popup, no redirect).
6. Copiá el **Client ID** generado y pegalo en `CONFIG.GOOGLE_CLIENT_ID`.

### 2. OAuth Consent Screen
1. En **APIs & Services → OAuth consent screen**.
2. Completá nombre de app, email de soporte.
3. En **Test users** agregá los emails autorizados (si la app está en modo Testing).
4. Para producción: publicá la app (requiere verificación de Google si usás scopes sensibles — en este caso no aplica porque solo usamos el perfil básico).

---

## 🌐 CORS con Apps Script

GAS maneja CORS automáticamente para peticiones `GET` cuando la Web App está desplegada como **"Cualquiera"** (Anyone).

Para `POST` desde el browser hacia GAS:
- Fetch usa `redirect: "follow"` (requerido por GAS).
- **No** enviés el header `Authorization` en el fetch — GAS lo ignora en doPost y puede bloquear la petición. El email del usuario se envía en el body JSON (`_user_email`).
- En tu `jsonResponse()` de GAS asegurate de NO estar seteando headers CORS manualmente si ya usás `ContentService` (lo maneja automáticamente).

Si seguís viendo errores de CORS:
```js
// En CODE.gs, asegurate que jsonResponse NO tenga esto:
// .setHeader("Access-Control-Allow-Origin", "*")  ← No necesario con ContentService
```

---

## ⚙️ Activador automático de Drive (Apps Script)

La función `syncCSVDesdeDrive()` está en el tab **Sincronizar CSV** de la app.
Copiá ese código y pegalo en tu proyecto GAS, luego:
1. Reemplazá `DRIVE_FOLDER_ID` con el ID de tu carpeta de Drive.
2. Ejecutá `instalarActivador()` manualmente **una sola vez** para crear el trigger semanal.

---

## 📌 Notas

- La tabla muestra máximo 500 filas para performance. La búsqueda filtra del lado del cliente.
- Los indicadores "Pagado / Pendiente" cruzan `nota_rnc` / `nota_rnpc` del expediente contra la columna `Nota` de la hoja pagos.
- El formulario de Nuevo Ingreso siempre envía `_user_email` para auditoría en el backend.
