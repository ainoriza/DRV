/**+
 * INASE · Gestión de Variedades
 * Frontend SPA — GitHub Pages
 *
 * ══════════════════════════════════════════════
 * CONFIGURACIÓN — editá estos valores:
 * ══════════════════════════════════════════════
 */
const CONFIG = {
  // 1. Tu Web App URL de Apps Script (terminada en /exec)
  API_URL: "https://script.google.com/macros/s/AKfycbzA9jeF2DnSRj1Bhfu24ZrB5BquZ5bGpQns4Z_H6T3B9IxSg8cAjAl8KtTqjvbDOav8/exec",

  // 2. Tu Client ID de Google Cloud (OAuth 2.0)
  GOOGLE_CLIENT_ID: "43163248778-qri63io046lkhtcj0h3fu6lj0ogpkbid.apps.googleusercontent.com",

  // 3. (Opcional) Dominio autorizado — dejá vacío si usás GitHub Pages por defecto
  // Ej: "miusuario.github.io"
  AUTHORIZED_DOMAIN: "",
};

/* ══════════════════════════════════════════════
   ESTADO GLOBAL
══════════════════════════════════════════════ */
const state = {
  user: null,          // { email, name, picture }
  expedientes: [],
  pagos: [],
  filteredRows: [],
  searchQ: "",
  filterTipo: "",
};

/* ══════════════════════════════════════════════
   GOOGLE IDENTITY SERVICES — LOGIN
══════════════════════════════════════════════ */
function initGoogleLogin() {
  if (typeof google === "undefined") {
    // Reintentar si el script aún no cargó
    setTimeout(initGoogleLogin, 300);
    return;
  }
  google.accounts.id.initialize({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    callback: handleCredentialResponse,
    auto_select: false,
  });
  google.accounts.id.renderButton(document.getElementById("google-signin-btn"), {
    theme: "filled_black",
    size: "large",
    text: "signin_with_google",
    shape: "rectangular",
    logo_alignment: "left",
  });
  // Intento de auto-login silencioso
  google.accounts.id.prompt();
}

function handleCredentialResponse(response) {
  // Decodificamos el JWT sin librería externa
  const payload = JSON.parse(atob(response.credential.split(".")[1]));
  state.user = {
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
    idToken: response.credential,
  };
  loginSuccess();
}

function loginSuccess() {
  document.getElementById("login-screen").classList.add("hidden");
  const appShell = document.getElementById("app-shell");
  appShell.classList.remove("hidden");
  appShell.classList.add("flex");

  document.getElementById("user-name").textContent = state.user.name || state.user.email;
  const avatar = document.getElementById("user-avatar");
  if (state.user.picture) {
    avatar.src = state.user.picture;
  } else {
    avatar.style.display = "none";
  }

  loadDashboard();
}

document.getElementById("logout-btn").addEventListener("click", () => {
  if (typeof google !== "undefined") google.accounts.id.disableAutoSelect();
  state.user = null;
  state.expedientes = [];
  state.pagos = [];
  document.getElementById("app-shell").classList.add("hidden");
  document.getElementById("app-shell").classList.remove("flex");
  document.getElementById("login-screen").classList.remove("hidden");
});

/* ══════════════════════════════════════════════
   API HELPERS
   
   GAS (Apps Script) hace una redirección 302 que
   el browser bloquea con fetch normal.
   
   ✅ GET  → JSONP  (evita CORS completamente)
   ✅ POST → fetch con mode:"no-cors" + FormData
             El backend recibe e.parameter en doPost
══════════════════════════════════════════════ */

/**
 * GET via JSONP — funciona sin CORS con GAS.
 * Requiere que tu doGet en GAS soporte ?callback=xxx
 * (ver instrucción abajo si aún no lo tiene).
 */
function apiGet(path, params = {}) {
  return new Promise((resolve, reject) => {
    const cbName = "_gasCallback_" + Date.now();
    const url = new URL(CONFIG.API_URL);
    url.searchParams.set("path", path);
    url.searchParams.set("callback", cbName);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const script = document.createElement("script");
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout — verificá que la API esté publicada como 'Cualquier persona'"));
    }, 15000);

    window[cbName] = (data) => {
      cleanup();
      resolve(data);
    };

    function cleanup() {
      clearTimeout(timer);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    script.onerror = () => { cleanup(); reject(new Error("Error cargando script JSONP")); };
    script.src = url.toString();
    document.head.appendChild(script);
  });
}

/**
 * POST via fetch con mode:"no-cors".
 * Con no-cors la respuesta es "opaque" (no podemos leerla),
 * así que hacemos un GET de confirmación inmediatamente después.
 * Para operaciones que necesiten respuesta usá apiPostReadable().
 */
async function apiPost(path, body = {}) {
  const url = new URL(CONFIG.API_URL);
  url.searchParams.set("path", path);

  const payload = { ...body, _user_email: state.user?.email };

  // Enviamos como application/x-www-form-urlencoded (más compatible con GAS)
  // GAS lo recibe en e.parameter
  const formBody = Object.entries(payload)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(typeof v === "object" ? JSON.stringify(v) : v)}`)
    .join("&");

  await fetch(url.toString(), {
    method: "POST",
    mode: "no-cors",           // Evita el error CORS — la respuesta será opaque
    redirect: "follow",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody,
  });

  // Como no podemos leer la respuesta opaque, devolvemos ok optimista
  return { ok: true };
}

/**
 * POST con cuerpo JSON y lectura de respuesta.
 * Requiere que en GAS hayas agregado los headers CORS en doPost
 * (ver instrucciones en README).
 * Usalo para extraer-zip y sync-csv donde necesitás leer la respuesta.
 */
async function apiPostReadable(path, body = {}) {
  const url = new URL(CONFIG.API_URL);
  url.searchParams.set("path", path);
  const payload = { ...body, _user_email: state.user?.email };

  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain" }, // text/plain evita preflight OPTIONS
      body: JSON.stringify(payload),
    });
    return res.json();
  } catch(err) {
    // Si sigue fallando por CORS, notificamos claramente
    throw new Error("CORS bloqueado en POST. Verificá que la Web App tenga acceso 'Cualquier persona' y agregá los headers CORS en tu doPost de GAS (ver README).");
  }
}

/* ══════════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════════ */
async function loadDashboard() {
  renderTableLoading();
  try {
    const [expedientes, pagos] = await Promise.all([
      apiGet("expedientes"),
      apiGet("pagos"),
    ]);
    state.expedientes = expedientes || [];
    state.pagos = pagos || [];
    renderStatCards();
    applyFilters();
  } catch (err) {
    renderTableError(err.message);
    showToast("Error cargando datos: " + err.message, "error");
  }
}

function renderStatCards() {
  const exps = state.expedientes;
  const soloRnc  = exps.filter(e => {
    const t = String(e.tipo_tramite || e.t || e.T || "");
    return t === "1" || t.toUpperCase() === "RNC";
  }).length;
  const solornpc = exps.filter(e => {
    const t = String(e.tipo_tramite || e.t || e.T || "");
    return t === "2" || t.toUpperCase() === "RNPC";
  }).length;
  const ambos = exps.filter(e => {
    const t = String(e.tipo_tramite || e.t || e.T || "");
    return t === "3" || t.toUpperCase().includes("RNC+") || t.toUpperCase().includes("RNC Y") || t.toUpperCase() === "RNC+RNPC";
  }).length;
  const pagadas  = buildPaidSet();

  const cards = [
    { label: "Total Expedientes", value: exps.length, color: "#f59e0b" },
    { label: "Solo RNC",   value: soloRnc,  color: "#60a5fa" },
    { label: "Solo RNPC",  value: solornpc, color: "#a78bfa" },
    { label: "RNC + RNPC", value: ambos,    color: "#34d399" },
  ];
  document.getElementById("stat-cards").innerHTML = cards.map(c => `
    <div class="stat-card">
      <div class="stat-label">${c.label}</div>
      <div class="stat-value" style="color:${c.color}">${c.value.toLocaleString("es-AR")}</div>
    </div>
  `).join("");

  // Stats bar en header
  document.getElementById("stats-bar").innerHTML = `
    <span>${exps.length} expedientes</span>
    <span class="text-stone-700">·</span>
    <span>${pagadas.size} pagos registrados</span>
  `;
  document.getElementById("stats-bar").classList.remove("hidden");
}

/** Construye un Set con todas las notas que aparecen en pagos */
function buildPaidSet() {
  const paid = new Set();
  (state.pagos || []).forEach(p => {
    const nota = p.nota || p.Nota || "";
    if (nota) paid.add(nota.trim());
  });
  return paid;
}

function applyFilters() {
  const q     = state.searchQ.toLowerCase();
  const tipo  = state.filterTipo;
  let rows    = state.expedientes;

  if (q) {
    rows = rows.filter(r =>
      [r.denominacion, r.especie_nombre, r.especie,
       r.exp_rnc, r.exp_rnpc,
       r.nota_rnc, r.nota_rnpc,
       r.nrnc, r.estado_rnc, r.estado_rnpc,
       r.obtentor, r.representante
      ].some(v => v && String(v).toLowerCase().includes(q))
    );
  }
  if (tipo) {
    rows = rows.filter(r => {
      const t = String(r.tipo_tramite || r.t || r.T || "").toUpperCase();
      if (tipo === "1") return t === "RNC";
      if (tipo === "2") return t === "RNPC";
      if (tipo === "3") return t.includes("RNC+") || t === "RNC+RNPC";
      return true;
    });
  }

  state.filteredRows = rows;
  renderTable(rows);
  document.getElementById("table-count").textContent =
    `Mostrando ${rows.length} de ${state.expedientes.length} registros`;
}

function renderTable(rows) {
  const paid = buildPaidSet();
  const body = document.getElementById("table-body");

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="12" class="loading-row">Sin resultados para la búsqueda</td></tr>`;
    return;
  }

  const tipoLabel = { "1": "RNC", "2": "RNPC", "3": "RNC+RNPC" };

  body.innerHTML = rows.slice(0, 500).map((r, idx) => {
    // Campos reales devueltos por la API GAS
    const nrnc    = r.nrnc || "—";
    const denom   = r.denominacion || "—";
    // especie puede ser ID numérico o nombre string
    const especie = r.especie_nombre || (typeof r.especie === "string" ? r.especie : "") || "—";
    const tipo    = String(r.tipo_tramite || r.t || "");
    const expRnc  = r.exp_rnc || "";
    const expRnpc = r.exp_rnpc || "";
    const notaRnc  = r.nota_rnc || "";
    const notaRnpc = r.nota_rnpc || "";
    const finRnc   = r.f_in_rnc || "";
    const estadoRnc  = r.estado_rnc || "";
    const estadoRnpc = r.estado_rnpc || "";

    const paidRnc  = notaRnc  && paid.has(notaRnc.trim());
    const paidRnpc = notaRnpc && paid.has(notaRnpc.trim());

    const shortExp = (exp) => {
      if (!exp || exp === "false" || exp === false) return "—";
      const m = String(exp).match(/EX-(\d{4})-(\d+)/);
      return m ? \`EX-\${m[1]}-\${m[2]}\` : String(exp).slice(0, 24);
    };

    const shortFecha = (f) => {
      if (!f || f === "false" || f === false) return "—";
      return String(f).slice(0, 10);
    };

    return \`<tr>
      <td class="font-mono text-stone-400 text-xs">\${nrnc}</td>
      <td class="font-medium max-w-[180px]" title="\${denom}">\${denom}</td>
      <td class="text-stone-400">\${especie}</td>
      <td>\${tipo ? \`<span class="badge badge-tipo">\${tipo}</span>\` : "—"}</td>
      <td class="font-mono text-xs text-stone-500" title="\${expRnc}">\${shortExp(expRnc)}</td>
      <td class="font-mono text-xs text-stone-500" title="\${expRnpc}">\${shortExp(expRnpc)}</td>
      <td class="font-mono text-xs text-stone-500" title="\${estadoRnc}">\${estadoRnc ? estadoRnc.slice(0, 22) + (estadoRnc.length > 22 ? "…" : "") : "—"}</td>
      <td class="font-mono text-xs text-stone-500" title="\${estadoRnpc}">\${estadoRnpc ? estadoRnpc.slice(0, 22) + (estadoRnpc.length > 22 ? "…" : "") : "—"}</td>
      <td>\${paidRnc  ? '<span class="badge badge-paid">✓ Pagado</span>' : '<span class="badge badge-unpaid">Pendiente</span>'}</td>
      <td>\${paidRnpc ? '<span class="badge badge-paid">✓ Pagado</span>' : '<span class="badge badge-unpaid">Pendiente</span>'}</td>
      <td class="text-stone-500 text-xs font-mono">\${shortFecha(finRnc)}</td>
      <td><button class="btn-row-detail" onclick="openDetail(\${idx})">Ver</button></td>
    </tr>\`;
  }).join("");
}

function renderTableLoading() {
  document.getElementById("table-body").innerHTML =
    `<tr><td colspan="12" class="loading-row"><div class="spinner"></div> Cargando expedientes…</td></tr>`;
}
function renderTableError(msg) {
  document.getElementById("table-body").innerHTML =
    `<tr><td colspan="12" class="loading-row" style="color:var(--danger)">Error: ${msg}</td></tr>`;
}

/* ── DETAIL MODAL ── */
function openDetail(idx) {
  const r = state.filteredRows[idx];
  if (!r) return;
  const paid = buildPaidSet();
  const notaRnc  = r.nota_rnc || r["NOTA RNC"] || "";
  const notaRnpc = r.nota_rnpc || r["NOTA RNPC"] || "";

  const skip = ["_user_email"];
  const rows = Object.entries(r)
    .filter(([k]) => !skip.includes(k) && r[k] !== "" && r[k] !== null && r[k] !== undefined)
    .map(([k, v]) => `
      <div class="detail-row">
        <span class="detail-key">${k}</span>
        <span class="detail-val">${v}</span>
      </div>`).join("");

  document.getElementById("modal-title").textContent =
    `${r.denominacion || r.Denominacion || "Expediente"} · ${r.nrnc || r.NRNC || ""}`;
  document.getElementById("modal-body").innerHTML = `
    <div class="flex gap-3 mb-4">
      ${notaRnc  ? (paid.has(notaRnc.trim())  ? '<span class="badge badge-paid">RNC Pagado</span>'  : '<span class="badge badge-unpaid">RNC Sin Pago</span>')  : ""}
      ${notaRnpc ? (paid.has(notaRnpc.trim()) ? '<span class="badge badge-paid">RNPC Pagado</span>' : '<span class="badge badge-unpaid">RNPC Sin Pago</span>') : ""}
    </div>
    ${rows}
  `;
  document.getElementById("detail-modal").classList.remove("hidden");
}

document.getElementById("close-modal").addEventListener("click", () => {
  document.getElementById("detail-modal").classList.add("hidden");
});
document.getElementById("detail-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add("hidden");
});

/* ══════════════════════════════════════════════
   SEARCH & FILTERS
══════════════════════════════════════════════ */
let searchTimeout;
document.getElementById("search-input").addEventListener("input", (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    state.searchQ = e.target.value;
    applyFilters();
  }, 250);
});

document.getElementById("filter-tipo").addEventListener("change", (e) => {
  state.filterTipo = e.target.value;
  applyFilters();
});

document.getElementById("refresh-btn").addEventListener("click", () => {
  state.searchQ = "";
  state.filterTipo = "";
  document.getElementById("search-input").value = "";
  document.getElementById("filter-tipo").value = "";
  loadDashboard();
  showToast("Datos actualizados", "success");
});

/* ══════════════════════════════════════════════
   TABS
══════════════════════════════════════════════ */
document.querySelectorAll(".nav-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
    document.getElementById(`tab-${tab}`).classList.remove("hidden");
    if (tab === "sync") renderGASCode();
  });
});

/* ══════════════════════════════════════════════
   ZIP UPLOAD → AI EXTRACTION
══════════════════════════════════════════════ */
const dropZone  = document.getElementById("drop-zone");
const zipInput  = document.getElementById("zip-input");
const zipStatus = document.getElementById("zip-status");

function setupDropZone(zone, input, accept, handler) {
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag-over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault(); zone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) handler(file);
  });
  input.addEventListener("change", () => { if (input.files[0]) handler(input.files[0]); });
}

setupDropZone(dropZone, zipInput, ".zip", async (file) => {
  if (!file.name.endsWith(".zip")) { showToast("Solo se aceptan archivos .zip", "error"); return; }
  zipStatus.classList.remove("hidden");
  zipStatus.textContent = "⏳ Leyendo ZIP y enviando a Gemini AI…";

  try {
    const b64 = await fileToBase64(file);
    const result = await apiPostReadable("extraer-zip", { zip_b64: b64.split(",")[1] });
    if (result.error) throw new Error(result.error);

    const datos = result.datos || {};
    zipStatus.textContent = "✓ Datos extraídos — revisá y completá el formulario";
    zipStatus.style.color = "var(--success)";

    // Autocompletar formulario
    const form = document.getElementById("expediente-form");
    Object.entries(datos).forEach(([key, val]) => {
      const el = form.querySelector(`[name="${key}"]`);
      if (el && val) el.value = val;
    });
    showToast("Formulario completado con datos de IA", "success");

    // Cambiar a tab de ingreso si no estamos ahí
    document.querySelector('[data-tab="ingreso"]').click();
  } catch (err) {
    zipStatus.textContent = "✕ Error: " + err.message;
    zipStatus.style.color = "var(--danger)";
    showToast(err.message, "error");
  }
});

/* ══════════════════════════════════════════════
   FORMULARIO MANUAL — CREAR EXPEDIENTE
══════════════════════════════════════════════ */
document.getElementById("expediente-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn  = document.getElementById("submit-form-btn");
  const data = Object.fromEntries(new FormData(form).entries());

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Guardando…';

  try {
    const result = await apiPost("expedientes", data);
    if (result.error) throw new Error(result.error);
    showToast("Expediente creado correctamente", "success");
    form.reset();
    // Recargar datos
    loadDashboard();
  } catch (err) {
    showToast("Error al guardar: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Crear Expediente';
  }
});

document.getElementById("clear-form-btn").addEventListener("click", () => {
  document.getElementById("expediente-form").reset();
  document.getElementById("zip-status").classList.add("hidden");
});

/* ── Autocomplete Especie ── */
let especieSuggestionsData = [];
document.getElementById("especie-input").addEventListener("input", async (e) => {
  const q = e.target.value.trim();
  const box = document.getElementById("especie-suggestions");
  if (q.length < 2) { box.classList.add("hidden"); return; }

  try {
    const results = await apiGet("especies", { q });
    especieSuggestionsData = results || [];
    if (!especieSuggestionsData.length) { box.classList.add("hidden"); return; }
    box.innerHTML = especieSuggestionsData.slice(0, 6).map((s, i) =>
      `<div class="suggestion-item" data-idx="${i}">${s.nombre || s.especie || s}</div>`
    ).join("");
    box.classList.remove("hidden");
    // Posicionar
    box.style.position = "absolute";
    box.style.width = e.target.offsetWidth + "px";
  } catch (_) {}
});

document.getElementById("especie-suggestions").addEventListener("click", (e) => {
  const item = e.target.closest(".suggestion-item");
  if (!item) return;
  const s = especieSuggestionsData[Number(item.dataset.idx)];
  document.getElementById("especie-input").value = s.nombre || s.especie || s;
  document.getElementById("especie-suggestions").classList.add("hidden");
});

document.addEventListener("click", (e) => {
  if (!e.target.closest("#especie-input") && !e.target.closest("#especie-suggestions")) {
    document.getElementById("especie-suggestions").classList.add("hidden");
  }
});

/* ══════════════════════════════════════════════
   SYNC CSV
══════════════════════════════════════════════ */
const csvDropZone = document.getElementById("csv-drop-zone");
const csvInput    = document.getElementById("csv-input");
const csvStatus   = document.getElementById("csv-status");

setupDropZone(csvDropZone, csvInput, ".csv", async (file) => {
  if (!file.name.endsWith(".csv")) { showToast("Solo se aceptan archivos .csv", "error"); return; }
  csvStatus.classList.remove("hidden");
  csvStatus.style.color = "var(--amber)";
  csvStatus.textContent = "⏳ Leyendo CSV y enviando al servidor…";

  try {
    const b64 = await fileToBase64(file);
    const result = await apiPostReadable("sync-csv", { csv_b64: b64.split(",")[1] });
    if (result.error) throw new Error(result.error);

    csvStatus.style.color = "var(--success)";
    csvStatus.textContent = `✓ Sincronización completada · ${result.actualizados || 0} expedientes actualizados`;

    if (result.detalles) {
      document.getElementById("csv-result").classList.remove("hidden");
      document.getElementById("csv-result").innerHTML = `
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Expediente</th><th>Acción</th></tr></thead>
            <tbody>${(result.detalles || []).map(d =>
              `<tr><td class="font-mono text-xs">${d.exp}</td><td class="text-stone-400 text-xs">${d.accion}</td></tr>`
            ).join("")}</tbody>
          </table>
        </div>`;
    }
    showToast("CSV sincronizado correctamente", "success");
    loadDashboard();
  } catch (err) {
    csvStatus.style.color = "var(--danger)";
    csvStatus.textContent = "✕ Error: " + err.message;
    showToast(err.message, "error");
  }
});

/* ══════════════════════════════════════════════
   GAS CODE (función de automatización Drive)
══════════════════════════════════════════════ */
const GAS_AUTOMATION_CODE = `/**
 * INASE · Automatización Drive
 * Agregá esta función a tu proyecto Apps Script.
 * Configurá un activador: Tiempo > Cada semana (o diario).
 */

// ── CONFIGURACIÓN ──
const DRIVE_FOLDER_ID = "TU_ID_DE_CARPETA_DRIVE"; // ID de la carpeta donde se sube el CSV
const ARCHIVO_PREFIJO = "Gestión_completo";         // Prefijo del nombre del CSV semanal

function syncCSVDesdeDrive() {
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const files  = folder.getFilesByName(ARCHIVO_PREFIJO);

  // Buscar el CSV más reciente con el prefijo dado
  let latestFile  = null;
  let latestDate  = new Date(0);

  const allFiles = folder.getFiles();
  while (allFiles.hasNext()) {
    const f = allFiles.next();
    if (f.getName().startsWith(ARCHIVO_PREFIJO) && f.getName().endsWith(".csv")) {
      if (f.getLastUpdated() > latestDate) {
        latestDate = f.getLastUpdated();
        latestFile = f;
      }
    }
  }

  if (!latestFile) {
    Logger.log("No se encontró ningún CSV con prefijo: " + ARCHIVO_PREFIJO);
    return;
  }

  // Control: evitar reprocesar el mismo archivo
  const props     = PropertiesService.getScriptProperties();
  const lastId    = props.getProperty("LAST_SYNCED_CSV_ID");
  const currentId = latestFile.getId();

  if (lastId === currentId) {
    Logger.log("CSV sin cambios desde la última sincronización: " + latestFile.getName());
    return;
  }

  Logger.log("Procesando CSV: " + latestFile.getName());

  // Leer contenido y encodear a base64
  const content = latestFile.getBlob().getDataAsString("ISO-8859-1");
  const b64     = Utilities.base64Encode(
    Utilities.newBlob(content, "text/plain", "csv").getBytes()
  );

  // Reutilizar la función syncCSV existente
  const fakeEvent = {
    postData: { contents: JSON.stringify({ csv_b64: b64 }) }
  };
  const resultado = syncCSV(fakeEvent);
  Logger.log("Resultado sync: " + JSON.stringify(resultado));

  // Marcar como procesado
  props.setProperty("LAST_SYNCED_CSV_ID", currentId);
  props.setProperty("LAST_SYNCED_DATE", new Date().toISOString());

  // Notificación por email al responsable (opcional)
  // MailApp.sendEmail("tu@email.com", "Sync CSV INASE", "CSV procesado: " + latestFile.getName());
}

/**
 * Crea el activador automático.
 * Ejecutá esta función UNA VEZ manualmente para instalar el activador.
 */
function instalarActivador() {
  // Eliminar activadores previos del mismo tipo
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "syncCSVDesdeDrive") ScriptApp.deleteTrigger(t);
  });
  // Crear activador semanal (lunes a las 8am)
  ScriptApp.newTrigger("syncCSVDesdeDrive")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)
    .create();
  Logger.log("Activador instalado correctamente.");
}
`;

function renderGASCode() {
  document.getElementById("gas-code-display").textContent = GAS_AUTOMATION_CODE;
}

document.getElementById("copy-gas-btn").addEventListener("click", () => {
  navigator.clipboard.writeText(GAS_AUTOMATION_CODE)
    .then(() => showToast("Código copiado al portapapeles", "success"))
    .catch(() => showToast("No se pudo copiar", "error"));
});

/* ══════════════════════════════════════════════
   UTILS
══════════════════════════════════════════════ */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function showToast(msg, type = "info") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast ${type}`;
  el.classList.remove("hidden");
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => el.classList.add("hidden"), 4000);
}

/* ══════════════════════════════════════════════
   INIT
══════════════════════════════════════════════ */
window.openDetail = openDetail; // Exponer para onclick inline
initGoogleLogin();
