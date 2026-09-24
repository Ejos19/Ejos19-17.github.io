// ==========================================================================
// PROYECTO: Tasa Oficial BCV + Historial (Banco Central de Venezuela)
// DESCRIPCIÓN: Lógica en JavaScript puro para consultar tasas en tiempo real,
//              monitorear automáticamente cambios en el BCV mediante sondeo
//              periódico y guardar el historial diario de forma automática.
// MODO: Archivo JS modular vinculado en public/index.html
// ==========================================================================

// =========================================================================
// 1. CONFIGURACIÓN GENERAL Y URL DEL WEB APP (GOOGLE APPS SCRIPT)
// =========================================================================
// Reemplaza esta URL con la URL de tu Google Apps Script desplegado como Web App
const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbz_H5qt4Wm596fGf_IrEPjH9o9zD2ZBCJ5-WwUhQp2YRWV4AX__6wc_rL0k-ICw68Jh/exec";

// Se espera a que todo el árbol del documento DOM esté completamente cargado y parseado
document.addEventListener("DOMContentLoaded", () => {
  // ------------------------------------------------------------------------
  // 1. CAPTURA Y REFERENCIA DE LOS ELEMENTOS DEL DOM
  // ------------------------------------------------------------------------

  // Elemento HTML donde se renderiza la tasa de cambio del Dólar Estadounidense
  const usdRateElement = document.getElementById("usd-rate");

  // Elemento HTML donde se renderiza la tasa de cambio del Euro
  const eurRateElement = document.getElementById("eur-rate");

  // Elemento HTML donde se muestra el estado de consulta y la fecha/hora de actualización
  const dateElement = document.getElementById("bcv-date");

  // Elemento HTML donde se renderiza la Fecha Valor oficial del BCV
  const bcvOfficialDateTextElement = document.getElementById("bcv-official-date-text") || dateElement;

  // Elemento HTML donde se renderiza la fecha y hora de la última verificación del sistema
  const systemCheckTimeElement = document.getElementById("system-check-time");

  // Botón que permite al usuario forzar la recarga manual de las tasas oficiales
  const refreshBtn = document.getElementById("refresh-btn");

  // Botón para alternar la visualización (expandir/contraer) del historial de tasas
  const toggleHistoryBtn = document.getElementById("toggle-history-btn");

  // Contenedor desplegable que encierra y anima el área del historial
  const historyContainer = document.getElementById("history-container");

  // Lista desordenada (<ul>) en la que se insertan los elementos (<li>) del historial
  const historyList = document.getElementById("history-list");

  // ------------------------------------------------------------------------
  // 2. DEFINICIÓN DE CONFIGURACIONES Y URLS DE LAS APIS
  // ------------------------------------------------------------------------

  // Endpoint local que consulta y extrae directamente del portal del BCV en tiempo real (activo en dev/Node/preview)
  const API_LOCAL_BCV = "/api/bcv";

  // Espejo oficial en tiempo real de BCV sin restricciones CORS (extrae de BCV y publica diario vía GitHub Actions/CDN)
  const API_MIRROR_BCV = "https://raw.githubusercontent.com/grupoclip/bcv-api/main/api/v1/history.json";
  const API_MIRROR_BCV_TODAY = "https://bcv.today/api/v1/history.json";

  // Endpoint secundario de respaldo dolarapi oficial USD
  const API_FALLBACK_USD = "https://ve.dolarapi.com/v1/dolares/oficial";

  // Endpoint secundario de respaldo dolarapi oficial EUR
  const API_FALLBACK_EUR = "https://ve.dolarapi.com/v1/euros/oficial";

  // Intervalo de tiempo para la comprobación automática en segundo plano (60 segundos = 60000 ms)
  const AUTO_REFRESH_INTERVAL_MS = 60000;

  // Variable en memoria para registrar la última firma o fecha oficial emitida por el BCV
  let lastOfficialDateIso = "";

  // Variable en memoria para registrar el último precio del dólar consultado
  let lastUsdPrice = "";

  // Variable en memoria para registrar el último precio del euro consultado
  let lastEurPrice = "";

  // Función normalizadora de fechas (ej: 13/9/2026) compatible con formatos ISO y locales
  function normalizeDateStr(dateStr) {
    if (!dateStr) return "";
    const clean = String(dateStr).trim();
    if (clean.includes("T")) {
      const dObj = new Date(clean);
      if (!isNaN(dObj.getTime())) {
        return `${dObj.getDate()}/${dObj.getMonth() + 1}/${dObj.getFullYear()}`;
      }
    }
    const parts = clean.split(/[\/\-]/);
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        // Formato ISO YYYY-MM-DD
        const y = parts[0];
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        if (!isNaN(d) && !isNaN(m)) {
          return `${d}/${m}/${y}`;
        }
      } else {
        // Formato DD/MM/YYYY
        const d = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const y = parts[2];
        if (!isNaN(d) && !isNaN(m)) {
          return `${d}/${m}/${y}`;
        }
      }
    }
    return clean;
  }

  // Formateador numérico oficial: usa "." para miles y "," para decimales (ej. 842,21 o 1.234,56)
  function formatNumberVES(val) {
    if (val === null || val === undefined || val === '') return '';
    const str = String(val).trim();
    if (str === '--' || str === '...' || str.toLowerCase() === 'error') return str;

    let clean = str.replace(/[^\d.,-]/g, '');
    if (clean.includes(',') && clean.includes('.')) {
      if (clean.lastIndexOf(',') > clean.lastIndexOf('.')) {
        clean = clean.replace(/\./g, '').replace(',', '.');
      } else {
        clean = clean.replace(/,/g, '');
      }
    } else if (clean.includes(',')) {
      clean = clean.replace(',', '.');
    }

    const num = parseFloat(clean);
    if (isNaN(num)) return str;

    const parts = num.toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return parts.join(',');
  }

  // Función auxiliar para normalizar y convertir el formato de fecha del BCV a D/M/AAAA
  function parseBcvDate(rawDateStr) {
    // Si la cadena está vacía o indefinida, retorna la fecha local venezolana actual
    if (!rawDateStr) return normalizeDateStr(new Date().toLocaleDateString("es-VE"));
    // Diccionario de equivalencia para los nombres de los meses en español
    const months = {
      enero: "1", febrero: "2", marzo: "3", abril: "4", mayo: "5", junio: "6",
      julio: "7", agosto: "8", septiembre: "9", octubre: "10", noviembre: "11", diciembre: "12"
    };
    // Expresión regular para capturar el día numérico, el nombre del mes y el año de 4 dígitos
    const match = rawDateStr.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i);
    // Si se encuentra coincidencia con la estructura esperada
    if (match) {
      const day = parseInt(match[1], 10);
      const month = parseInt(months[match[2].toLowerCase()] || "1", 10);
      const year = match[3];
      return `${day}/${month}/${year}`;
    }
    // Si no coincide con el patrón mensual, devuelve la cadena original normalizada
    return normalizeDateStr(rawDateStr);
  }

  // ------------------------------------------------------------------------
  // 3. FUNCIÓN ASÍNCRONA PARA CONSULTAR LAS TASAS EN TIEMPO REAL
  // ------------------------------------------------------------------------
  // El parámetro isBackground define si la consulta es automática (silenciosa) o manual
  async function fetchRates(isBackground = false) {
    try {
      // Si la consulta fue solicitada manualmente por el usuario o es la inicial:
      if (!isBackground) {
        // Indicador visual en el elemento USD mientras se realiza la consulta de red
        usdRateElement.textContent = "...";

        // Indicador visual en el elemento EUR mientras se realiza la consulta de red
        eurRateElement.textContent = "...";

        // Mensaje informativo que notifica al usuario que se está contactando al BCV
        if (bcvOfficialDateTextElement) {
          bcvOfficialDateTextElement.textContent = "Consultando Banco Central...";
        }
      }

      // Variable para almacenar el precio procesado del dólar
      let usdPrice = null;

      // Variable para almacenar el precio procesado del euro
      let eurPrice = null;

      // Variable para almacenar el texto que se desplegará en la tarjeta de fecha
      let displayDateText = "";

      // Variable para almacenar la fecha formateada para el historial
      let historyDateStr = "";

      // Variable para la fecha calendario de hoy para garantizar evaluación diaria
      let currentCalendarDate = "";

      // Variable para la marca de tiempo de la última verificación del sistema
      let systemCheckTime = "";

      // Variable identificadora única para detectar si hubo un cambio oficial
      let rateSourceId = "";

      // 1. INTENTO PRIMARIO: Endpoint directo en tiempo real del servidor local (/api/bcv)
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        const localRes = await fetch(`${API_LOCAL_BCV}?t=${Date.now()}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (localRes.ok) {
          const localData = await localRes.json();
          if (localData && localData.success && localData.usd && localData.eur) {
            usdPrice = localData.usd;
            eurPrice = localData.eur;
            displayDateText = localData.fechaValor;
            historyDateStr = localData.officialBcvDate || parseBcvDate(localData.fechaCorta);
            currentCalendarDate = localData.currentCalendarDate || normalizeDateStr(new Date().toLocaleDateString("es-VE", { timeZone: "America/Caracas" }));
            systemCheckTime = localData.systemCheckTime || new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" });
            rateSourceId = `bcv-${localData.rawUsd || usdPrice}-${localData.rawEur || eurPrice}-${localData.fechaValor}`;
          }
        }
      } catch (localErr) {
        // En dominios externos estáticos /api/bcv no existe, continúa fluidamente a los siguientes métodos
      }

      // 2. INTENTO SECUNDARIO: Espejo oficial en tiempo real de BCV (CORS Abierto '*' para cualquier dominio)
      // Extrae la cotización oficial más reciente del BCV publicada hoy, permitiendo actualización autónoma sin requerir el preview
      if (!usdPrice || !eurPrice) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          const mirrorRes = await fetch(`${API_MIRROR_BCV}?t=${Date.now()}`, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (mirrorRes.ok) {
            const historyList = await mirrorRes.json();
            if (Array.isArray(historyList) && historyList.length > 0) {
              const last = historyList[historyList.length - 1];
              if (last && (last.USD || last.usd) && (last.EUR || last.eur)) {
                usdPrice = formatNumberVES(last.USD || last.usd);
                eurPrice = formatNumberVES(last.EUR || last.eur);
                const rawDate = last.effective_date || last.date || "";
                historyDateStr = normalizeDateStr(rawDate);
                displayDateText = `Fecha Valor: ${historyDateStr}`;
                currentCalendarDate = normalizeDateStr(new Date().toLocaleDateString("es-VE", { timeZone: "America/Caracas" }));
                systemCheckTime = new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" });
                rateSourceId = `mirror-bcv-${usdPrice}-${eurPrice}-${historyDateStr}`;
              }
            }
          }
        } catch (mirrorErr) {
          // Respaldo alternativo del espejo
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);
            const todayRes = await fetch(`${API_MIRROR_BCV_TODAY}?t=${Date.now()}`, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (todayRes.ok) {
              const historyList = await todayRes.json();
              if (Array.isArray(historyList) && historyList.length > 0) {
                const last = historyList[historyList.length - 1];
                if (last && (last.USD || last.usd) && (last.EUR || last.eur)) {
                  usdPrice = formatNumberVES(last.USD || last.usd);
                  eurPrice = formatNumberVES(last.EUR || last.eur);
                  const rawDate = last.effective_date || last.date || "";
                  historyDateStr = normalizeDateStr(rawDate);
                  displayDateText = `Fecha Valor: ${historyDateStr}`;
                  currentCalendarDate = normalizeDateStr(new Date().toLocaleDateString("es-VE", { timeZone: "America/Caracas" }));
                  systemCheckTime = new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" });
                  rateSourceId = `mirror-today-${usdPrice}-${eurPrice}-${historyDateStr}`;
                }
              }
            }
          } catch (todayErr) {}
        }
      }

      // 3. INTENTO TERCIARIO: Consultar el Web App de Google Apps Script directamente desde Google Cloud
      if ((!usdPrice || !eurPrice) && typeof SCRIPT_URL !== "undefined" && SCRIPT_URL && SCRIPT_URL.startsWith("http")) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 6000);
          const gsRes = await fetch(`${SCRIPT_URL}?action=bcv&t=${Date.now()}`, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (gsRes.ok) {
            const gsData = await gsRes.json();
            if (gsData && (gsData.usd || gsData.USD) && (gsData.eur || gsData.EUR)) {
              usdPrice = formatNumberVES(gsData.usd || gsData.USD);
              eurPrice = formatNumberVES(gsData.eur || gsData.EUR);
              displayDateText = gsData.fechaValor || `Fecha Valor: ${gsData.officialBcvDate || gsData.Fecha}`;
              historyDateStr = normalizeDateStr(gsData.officialBcvDate || gsData.Fecha || gsData.date);
              currentCalendarDate = normalizeDateStr(new Date().toLocaleDateString("es-VE", { timeZone: "America/Caracas" }));
              systemCheckTime = gsData.systemCheckTime || new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" });
              rateSourceId = `gs-bcv-${usdPrice}-${eurPrice}-${historyDateStr}`;
            }
          }
        } catch (gsErr) {}

        if (!usdPrice || !eurPrice) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);
            const gsRes2 = await fetch(`${SCRIPT_URL}?t=${Date.now()}`, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (gsRes2.ok) {
              const gsData2 = await gsRes2.json();
              if (gsData2 && gsData2.lastRate && (gsData2.lastRate.USD || gsData2.lastRate.usd)) {
                const lr = gsData2.lastRate;
                usdPrice = formatNumberVES(lr.USD || lr.usd);
                eurPrice = formatNumberVES(lr.EUR || lr.eur);
                const rawDate = lr.Fecha || lr.fecha || lr.date || "";
                historyDateStr = normalizeDateStr(rawDate);
                displayDateText = `Fecha Valor: ${historyDateStr}`;
                currentCalendarDate = normalizeDateStr(new Date().toLocaleDateString("es-VE", { timeZone: "America/Caracas" }));
                systemCheckTime = new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" });
                rateSourceId = `gs-sheet-${usdPrice}-${eurPrice}-${historyDateStr}`;
              }
            }
          } catch (gsErr2) {}
        }
      }

      // 4. INTENTO CUATERNARIO DE RESPALDO: DolarApi Oficial
      if (!usdPrice || !eurPrice) {
        const [usdResponse, eurResponse] = await Promise.all([
          fetch(`${API_FALLBACK_USD}?t=${Date.now()}`),
          fetch(`${API_FALLBACK_EUR}?t=${Date.now()}`),
        ]);

        if (!usdResponse.ok || !eurResponse.ok) {
          throw new Error("Fallo en la comunicación con todas las fuentes de cotización");
        }

        const usdData = await usdResponse.json();
        const eurData = await eurResponse.json();

        usdPrice = formatNumberVES(usdData.promedio);
        eurPrice = formatNumberVES(eurData.promedio);

        const currentIso = usdData.fechaActualizacion || new Date().toISOString();
        const updateDate = new Date(currentIso);
        displayDateText = `Fecha Valor: ${updateDate.toLocaleString("es-VE", { dateStyle: "medium" })}`;
        historyDateStr = updateDate.toLocaleDateString("es-VE");
        currentCalendarDate = normalizeDateStr(new Date().toLocaleDateString("es-VE", { timeZone: "America/Caracas" }));
        systemCheckTime = new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" });
        rateSourceId = `dolarapi-${usdPrice}-${eurPrice}-${currentIso}`;
      }

      // Se comprueba si hubo algún cambio con respecto a los datos previos registrados
      const hasChanged =
        rateSourceId !== lastOfficialDateIso ||
        usdPrice !== lastUsdPrice ||
        eurPrice !== lastEurPrice;

      // Se actualizan los valores de referencia en memoria
      lastOfficialDateIso = rateSourceId;
      lastUsdPrice = usdPrice;
      lastEurPrice = eurPrice;

      const formattedUsd = formatNumberVES(usdPrice);
      const formattedEur = formatNumberVES(eurPrice);

      // Se inyecta la tasa formateada del Dólar en el elemento correspondiente del HTML
      usdRateElement.textContent = `Bs. ${formattedUsd}`;

      // Se inyecta la tasa formateada del Euro en el elemento correspondiente del HTML
      eurRateElement.textContent = `Bs. ${formattedEur}`;

      // Se inyecta la Fecha Valor oficial del BCV
      if (bcvOfficialDateTextElement) {
        bcvOfficialDateTextElement.textContent = displayDateText;
      }

      // Se inyecta la marca de tiempo de la verificación realizada por nuestro proyecto
      if (systemCheckTimeElement && systemCheckTime) {
        systemCheckTimeElement.textContent = systemCheckTime;
      }

      // Regla 1 & 2: Guardar y sincronizar fecha oficial del BCV
      saveToHistory(historyDateStr, formattedUsd, formattedEur);

      // Regla 3: Si la tasa no cambia y la fecha tampoco, evaluar la fecha actual correspondiente
      // con la última tasa actualizada para garantizar que cada día sea evaluado en historial y en Sheets
      if (currentCalendarDate && normalizeDateStr(currentCalendarDate) !== normalizeDateStr(historyDateStr)) {
        saveToHistory(currentCalendarDate, formattedUsd, formattedEur);
      }
    } catch (error) {
      // Registro del error en la consola del desarrollador para diagnóstico
      console.error("Error al consultar tasas del BCV:", error);

      // Solo si fue una petición manual y los valores están vacíos mostramos error visual
      if (!isBackground && usdRateElement.textContent === "...") {
        usdRateElement.textContent = "Error";
        eurRateElement.textContent = "Error";
        if (bcvOfficialDateTextElement) {
          bcvOfficialDateTextElement.textContent = "Intente de nuevo más tarde.";
        }
      }
    }
  }

  // ------------------------------------------------------------------------
  // 4. LÓGICA DE ALMACENAMIENTO Y GESTIÓN AUTOMÁTICA DEL HISTORIAL
  // ------------------------------------------------------------------------
  function saveToHistory(dateInput, usd, eur) {
    // Se extrae la representación del día normalizada para identificar la jornada (ej. "13/9/2026")
    const rawDay = typeof dateInput === "string" ? dateInput : dateInput.toLocaleDateString("es-VE");
    const dayString = normalizeDateStr(rawDay);

    // Se obtiene el historial existente almacenado en localStorage o se crea un arreglo vacío
    let history = JSON.parse(localStorage.getItem("bcv_history")) || [];

    // Se busca si ya existe un registro almacenado con la misma fecha
    const todayIndex = history.findIndex((item) => normalizeDateStr(item.date) === dayString);

    const formattedUsd = formatNumberVES(usd);
    const formattedEur = formatNumberVES(eur);

    // Objeto estructurado que almacena la fecha, la tasa de USD y la tasa de EUR con separador "." miles y "," decimales
    const newRecord = { date: dayString, usd: formattedUsd, eur: formattedEur };

    // Si ya existe un registro para esta fecha:
    if (todayIndex >= 0) {
      // Se actualiza automáticamente el registro existente si la cotización varió
      history[todayIndex] = newRecord;
    } else {
      // Si es una nueva fecha oficial, se añade al principio del arreglo
      history.unshift(newRecord);
    }

    // Se limita el arreglo a un máximo de 15 registros para optimizar el almacenamiento
    if (history.length > 15) {
      history.pop();
    }

    // Se persiste el arreglo convertido a cadena JSON en localStorage bajo la clave 'bcv_history'
    localStorage.setItem("bcv_history", JSON.stringify(history));

    // Sincronización inmediata con el servidor para que Power Query siempre tenga la última actualización
    try {
      fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newRecord),
      }).catch(() => {});
    } catch {
      // Fallo silencioso de red
    }

    // Sincronización automática con Google Sheets (Hoja: "Tasa Diaria")
    // Se envía respetando las 3 condiciones solicitadas por el usuario:
    // 1. Tasa oficial cambia -> Envía
    // 2. Fecha oficial cambia -> Envía
    // 3. No cambia -> Evalúa día actual y envía con última tasa para asegurar evaluación diaria
    // Además previene duplicados comprobando la fecha sincronizada
    try {
      const syncedMapRaw = localStorage.getItem("bcv_sheets_synced_map");
      let syncedMap = {};
      if (syncedMapRaw) {
        try { syncedMap = JSON.parse(syncedMapRaw); } catch (e) {}
      }

      const isBcvChanged = !syncedMap[dayString] ||
        syncedMap[dayString].usd !== formattedUsd ||
        syncedMap[dayString].eur !== formattedEur;

      if (isBcvChanged) {
        syncToGoogleSheets(dayString, formattedUsd, formattedEur, false).then((res) => {
          if (res && res.success && !res.skipped) {
            syncedMap[dayString] = { usd: formattedUsd, eur: formattedEur, timestamp: Date.now() };
            localStorage.setItem("bcv_sheets_synced_map", JSON.stringify(syncedMap));
            localStorage.setItem(
              "bcv_sheets_last_sync",
              JSON.stringify({ date: dayString, usd: formattedUsd, eur: formattedEur })
            );
          }
        });
      }
    } catch (e) {
      console.warn("Control de duplicados sheets:", e);
    }

    // Se invoca la función para redibujar visualmente el listado de historial en la interfaz
    renderHistory();
  }

  // Registros iniciales oficiales para garantizar datos inmediatos a Power Query y nuevos usuarios
  const DEFAULT_HISTORY = [
    { date: "13/9/2026", usd: "842,21", eur: "977,88" },
    { date: "12/9/2026", usd: "842,21", eur: "977,88" },
    { date: "11/9/2026", usd: "832,49", eur: "968,07" },
  ];

  // Función encargada de dibujar en el DOM los elementos de la tabla del historial
  function renderHistory() {
    // Se recuperan los datos guardados en localStorage o se inicializa con el historial por defecto
    let history = [];
    try {
      const stored = localStorage.getItem("bcv_history");
      if (stored) {
        history = JSON.parse(stored);
      }
    } catch (e) {
      console.error("Error leyendo historial de localStorage:", e);
    }

    // Si el almacenamiento local no tiene datos aún, se utiliza el historial por defecto y se persiste
    if (!Array.isArray(history) || history.length === 0) {
      history = DEFAULT_HISTORY;
      try {
        localStorage.setItem("bcv_history", JSON.stringify(DEFAULT_HISTORY));
      } catch (e) {
        console.error("Error guardando historial inicial en localStorage:", e);
      }
    }

    // Se vacía el contenido previo del cuerpo de la tabla para evitar duplicidades visuales
    historyList.innerHTML = "";

    // Si por alguna razón no hubiera registros, se muestra un mensaje informativo en una fila completa
    if (history.length === 0) {
      // Se inyecta una fila <tr> con celda que abarca las 3 columnas
      historyList.innerHTML =
        '<tr class="history-item"><td colspan="3" class="history-empty">No hay historial aún</td></tr>';
      return;
    }

    // Se itera sobre cada uno de los registros del historial para generar sus filas
    history.forEach((item) => {
      // Se crea un nuevo elemento <tr> en memoria para la fila de datos
      const tr = document.createElement("tr");

      // Se le asigna la clase CSS 'history-item' para aplicar el formato correspondiente
      tr.className = "history-item";

      // Se inyectan las celdas <td> de fecha, USD y EUR en formato estructurado para Power Query
      tr.innerHTML = `
        <td class="history-date">${item.date}</td>
        <td class="history-usd">${formatNumberVES(item.usd)}</td>
        <td class="history-eur">${formatNumberVES(item.eur)}</td>
      `;

      // Se añade la fila <tr> hija al cuerpo de la tabla <tbody>
      historyList.appendChild(tr);
    });
  }

  // ------------------------------------------------------------------------
  // 5. CONTROLADOR DEL BOTÓN DE EXPANDIR / CONTRAER HISTORIAL
  // ------------------------------------------------------------------------
  toggleHistoryBtn.addEventListener("click", () => {
    // Alterna la presencia de la clase CSS 'history-hidden' que controla el max-height
    historyContainer.classList.toggle("history-hidden");

    // Se actualiza el texto y la flecha del botón según el estado actual de visibilidad
    if (historyContainer.classList.contains("history-hidden")) {
      // Si ahora está oculto, el botón invita a ver el historial con flecha hacia abajo
      toggleHistoryBtn.textContent = "Ver Historial ▼";
    } else {
      // Si ahora está visible, el botón invita a ocultar el historial con flecha hacia arriba
      toggleHistoryBtn.textContent = "Ocultar Historial ▲";
    }
  });

  // ------------------------------------------------------------------------
  // 6. ASIGNACIÓN DE EVENTOS DE INTERACCIÓN, MONITOREO Y AUTOMATIZACIÓN
  // ------------------------------------------------------------------------

  // Se asigna la función fetchRates con false al evento click del botón manual
  refreshBtn.addEventListener("click", () => fetchRates(false));

  // Carga previa del historial guardado en localStorage al iniciar
  renderHistory();

  // Sincronización con el servidor local o Google Sheets para mantener actualizados los registros
  function initializeHistory() {
    fetch("/api/history")
      .then((res) => {
        if (!res.ok) throw new Error("API local no disponible");
        return res.json();
      })
      .then((data) => {
        if (data && data.success && Array.isArray(data.history) && data.history.length > 0) {
          let localHistory = [];
          try {
            localHistory = JSON.parse(localStorage.getItem("bcv_history")) || [];
          } catch (e) {}

          const map = new Map();
          data.history.forEach((item) => map.set(item.date, item));
          localHistory.forEach((item) => map.set(item.date, item));

          const merged = Array.from(map.values())
            .map((item) => ({
              date: item.date,
              usd: formatNumberVES(item.usd),
              eur: formatNumberVES(item.eur),
            }))
            .slice(0, 20);
          localStorage.setItem("bcv_history", JSON.stringify(merged));
          renderHistory();
        } else {
          syncHistoryFromGoogleSheets();
        }
      })
      .catch(() => {
        syncHistoryFromGoogleSheets();
      });
  }

  function syncHistoryFromGoogleSheets() {
    if (typeof SCRIPT_URL !== "undefined" && SCRIPT_URL && SCRIPT_URL.startsWith("http")) {
      fetch(`${SCRIPT_URL}?t=${Date.now()}`)
        .then((res) => res.json())
        .then((data) => {
          if (data && Array.isArray(data.records) && data.records.length > 0) {
            const mapped = data.records.map((r) => {
              const rawDate = r.Fecha || r.fecha || r.date || "";
              const cleanDate = normalizeDateStr(rawDate.includes("T") ? new Date(rawDate).toLocaleDateString("es-VE") : rawDate);
              return {
                date: cleanDate,
                usd: formatNumberVES(r.USD || r.usd),
                eur: formatNumberVES(r.EUR || r.eur),
              };
            }).reverse().slice(0, 20);

            if (mapped.length > 0) {
              localStorage.setItem("bcv_history", JSON.stringify(mapped));
              renderHistory();
            }
          }
        })
        .catch(() => {});
    }
  }

  initializeHistory();

  // Primera consulta inmediata de tasas oficiales del BCV en tiempo real
  fetchRates(false);

  // ------------------------------------------------------------------------
  // MONITOREO AUTOMÁTICO EN TIEMPO REAL:
  // ------------------------------------------------------------------------

  // 1. Sondeo automático periódico continuo cada 60 segundos
  setInterval(() => {
    // Se ejecuta la consulta en segundo plano de manera silenciosa y automática
    fetchRates(true);
  }, AUTO_REFRESH_INTERVAL_MS);

  // 2. Consulta automática inmediata cuando la pestaña vuelve a estar visible en pantalla
  document.addEventListener("visibilitychange", () => {
    // Si la pestaña vuelve al primer plano visible:
    if (document.visibilityState === "visible") {
      // Se consultan las tasas en segundo plano para capturar cualquier actualización emitida
      fetchRates(true);
    }
  });

  // 3. Consulta automática inmediata cuando la ventana recupera el foco del usuario
  window.addEventListener("focus", () => {
    // Se ejecuta la verificación en segundo plano
    fetchRates(true);
  });

  // 4. Consulta automática inmediata cuando el navegador recupera la conexión a internet
  window.addEventListener("online", () => {
    // Se reactiva la consulta en segundo plano
    fetchRates(true);
  });

  // ------------------------------------------------------------------------
  // 7. SINCRONIZACIÓN AUTOMÁTICA Y MANUAL CON GOOGLE SHEETS ("Tasa Diaria")
  // ------------------------------------------------------------------------
  // Envío a la hoja "Tasa Diaria" utilizando SCRIPT_URL
  // CONTROL ESTRICTO: Solo transmite si el BCV actualizó su fecha o tasa, o si se fuerza manualmente (isManual = true)
  async function syncToGoogleSheets(date, usd, eur, isManual = false) {
    if (!date || !usd || !eur) return false;
    const targetUrl = (typeof SCRIPT_URL !== "undefined" && SCRIPT_URL)
      ? SCRIPT_URL.trim()
      : (localStorage.getItem("google_sheets_script_url") || "");

    if (!targetUrl) {
      console.warn("Google Sheets: SCRIPT_URL no configurada. Revisa la constante SCRIPT_URL al inicio del archivo script.js.");
      return false;
    }

    const normDate = normalizeDateStr(date);
    const formattedUsd = formatNumberVES(usd);
    const formattedEur = formatNumberVES(eur);

    // Verificación en cliente para evitar transmisiones redundantes
    if (!isManual) {
      try {
        const syncedMap = JSON.parse(localStorage.getItem("bcv_sheets_synced_map") || "{}");
        if (syncedMap[normDate]) {
          if (syncedMap[normDate].usd === formattedUsd && syncedMap[normDate].eur === formattedEur) {
            return { success: true, message: `Tasa ya sincronizada para el ${normDate}`, skipped: true };
          }
        }
      } catch (e) {}
    }

    // 1. Envío a través del endpoint proxy local (/api/sync-sheets) si existe servidor backend
    try {
      const res = await fetch("/api/sync-sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: normDate, usd: formattedUsd, eur: formattedEur, url: targetUrl, force: isManual }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.success) {
          try {
            const syncedMap = JSON.parse(localStorage.getItem("bcv_sheets_synced_map") || "{}");
            syncedMap[normDate] = { usd: formattedUsd, eur: formattedEur, timestamp: Date.now() };
            localStorage.setItem("bcv_sheets_synced_map", JSON.stringify(syncedMap));
          } catch (e) {}

          if (data.skipped) {
            console.log(`[Google Sheets] ℹ️ Sin cambios en BCV para el ${normDate}. Se omite transmisión.`);
          } else {
            console.log(`[Google Sheets] ✅ Tasa del ${normDate} sincronizada exitosamente en hoja 'Tasa Diaria': USD ${formattedUsd} | EUR ${formattedEur}`);
          }
          return { success: true, message: data.message || "¡Enviado a Tasa Diaria!", skipped: Boolean(data.skipped) };
        }
      }
    } catch (err) {
      console.warn("[Google Sheets] Proxy local no presente (entorno estático/externo), procediendo con envío directo a Apps Script.");
    }

    // 2. Transmisión directa a Google Apps Script (CRUCIAL PARA DOMINIOS EXTERNOS ESTÁTICOS)
    // Funciona tanto para el sondeo automático como para el botón manual
    if (targetUrl) {
      try {
        const queryParams = new URLSearchParams({
          action: "save",
          sheetName: "Tasa Diaria",
          Fecha: normDate,
          USD: formattedUsd,
          EUR: formattedEur,
          timestamp: String(Date.now()),
        });
        const getUrl = `${targetUrl}?${queryParams.toString()}`;

        // Transmisión 1: Petición GET con parámetros en URL (inmune a redirecciones 302 en navegadores)
        try {
          fetch(getUrl, { mode: "no-cors", cache: "no-store" }).catch(() => {});
        } catch (e) {}

        // Transmisión 2: Dispatcher vía objeto Image (garantiza emisión inmediata sin bloqueo de políticas)
        try {
          const img = new Image();
          img.src = getUrl;
        } catch (e) {}

        // Transmisión 3: Petición POST no-cors como respaldo
        try {
          await fetch(targetUrl, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({
              action: "save",
              sheetName: "Tasa Diaria",
              Fecha: normDate,
              USD: formattedUsd,
              EUR: formattedEur,
              timestamp: new Date().toISOString(),
            }),
          });
        } catch (postErr) {}

        // Registrar en caché local de sincronización para evitar duplicados en siguientes ciclos
        try {
          const syncedMap = JSON.parse(localStorage.getItem("bcv_sheets_synced_map") || "{}");
          syncedMap[normDate] = { usd: formattedUsd, eur: formattedEur, timestamp: Date.now() };
          localStorage.setItem("bcv_sheets_synced_map", JSON.stringify(syncedMap));
        } catch (e) {}

        console.log(`[Google Sheets] ✅ Tasa del ${normDate} transmitida exitosamente a Apps Script: USD ${formattedUsd} | EUR ${formattedEur}`);
        return { success: true, message: "¡Enviado a Tasa Diaria!" };
      } catch (directErr) {
        console.error("[Google Sheets] Error al sincronizar con Google Sheets:", directErr);
        return { success: false, message: "Error de conexión con Google Sheets" };
      }
    }

    return { success: true, message: "Sin cambios para transmitir", skipped: true };
  }

  // Event listener para el botón manual de forzar envío a Google Sheets
  const forceSheetsBtn = document.getElementById("force-sheets-btn");
  if (forceSheetsBtn) {
    forceSheetsBtn.addEventListener("click", async () => {
      let targetDate = "";
      let targetUsd = "";
      let targetEur = "";

      const history = JSON.parse(localStorage.getItem("bcv_history")) || DEFAULT_HISTORY;
      if (history && history.length > 0) {
        targetDate = history[0].date;
        targetUsd = history[0].usd;
        targetEur = history[0].eur;
      } else {
        const usdText = usdRateElement.textContent.replace("Bs.", "").trim();
        const eurText = eurRateElement.textContent.replace("Bs.", "").trim();
        if (usdText && usdText !== "--" && usdText !== "...") {
          targetDate = normalizeDateStr(new Date().toLocaleDateString("es-VE"));
          targetUsd = usdText;
          targetEur = eurText;
        }
      }

      if (!targetDate || !targetUsd || targetUsd === "--" || targetUsd === "...") {
        forceSheetsBtn.innerHTML = '<span class="sheets-btn-icon">⚠️</span> Sin tasas para enviar';
        setTimeout(() => {
          forceSheetsBtn.innerHTML = '<span class="sheets-btn-icon">📊</span> Forzar Envío a Google Sheets';
        }, 2500);
        return;
      }

      const originalHtml = forceSheetsBtn.innerHTML;
      forceSheetsBtn.disabled = true;
      forceSheetsBtn.innerHTML = '<span class="sheets-btn-icon">⏳</span> Enviando a Google Sheets...';

      const result = await syncToGoogleSheets(targetDate, targetUsd, targetEur, true);
      if (result.success) {
        forceSheetsBtn.innerHTML = '<span class="sheets-btn-icon">✅</span> ¡Enviado a Tasa Diaria!';
        try {
          localStorage.setItem(
            "bcv_sheets_last_sync",
            JSON.stringify({ date: targetDate, usd: targetUsd, eur: targetEur })
          );
        } catch (e) {}
      } else {
        if (result.message && (result.message.includes("Permiso") || result.message.includes("403"))) {
          forceSheetsBtn.innerHTML = '<span class="sheets-btn-icon">⚠️</span> Error 403 (Permiso Apps Script)';
        } else {
          forceSheetsBtn.innerHTML = '<span class="sheets-btn-icon">⚠️</span> Error al enviar';
        }
      }

      setTimeout(() => {
        forceSheetsBtn.disabled = false;
        forceSheetsBtn.innerHTML = originalHtml;
      }, 3500);
    });
  }
});
