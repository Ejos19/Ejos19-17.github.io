// ==========================================================================
// PROYECTO: Tasa Oficial BCV + Historial (Banco Central de Venezuela)
// DESCRIPCIÓN: Lógica en JavaScript puro para consultar tasas en tiempo real,
//              monitorear automáticamente cambios en el BCV mediante sondeo
//              periódico y guardar el historial diario de forma automática.
// MODO: Archivo JS modular vinculado en public/index.html
// ==========================================================================

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

  // Endpoint local que consulta y extrae directamente del portal del BCV en tiempo real
  const API_LOCAL_BCV = "/api/bcv";

  // Endpoint de respaldo en tiempo real CORS público (extrae directamente del BCV)
  const API_REALTIME_BCV = "https://dolar-vzla.rafnixg.dev/api/v1/bcv/realtime";

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

  // Función normalizadora de fechas (ej: 13/9/2026)
  function normalizeDateStr(dateStr) {
    if (!dateStr) return "";
    const clean = dateStr.trim();
    const parts = clean.split(/[\/\-]/);
    if (parts.length === 3) {
      const d = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const y = parts[2];
      if (!isNaN(d) && !isNaN(m)) {
        return `${d}/${m}/${y}`;
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
        dateElement.textContent = "Consultando Banco Central...";
      }

      // Variable para almacenar el precio procesado del dólar
      let usdPrice = null;

      // Variable para almacenar el precio procesado del euro
      let eurPrice = null;

      // Variable para almacenar el texto que se desplegará en la tarjeta de fecha
      let displayDateText = "";

      // Variable para almacenar la fecha formateada para el historial
      let historyDateStr = "";

      // Variable identificadora única para detectar si hubo un cambio oficial
      let rateSourceId = "";

      // 1. INTENTO PRIMARIO: Endpoint directo en tiempo real del servidor local (/api/bcv)
      try {
        // Controlador de aborto para establecer un límite de espera de 4 segundos
        const controller = new AbortController();
        // Temporizador para abortar si la petición excede el tiempo límite
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        // Petición HTTP GET al endpoint local con parámetro anti-caché
        const localRes = await fetch(`${API_LOCAL_BCV}?t=${Date.now()}`, { signal: controller.signal });
        // Limpieza del temporizador
        clearTimeout(timeoutId);
        // Verificación de respuesta exitosa
        if (localRes.ok) {
          // Decodificación de la respuesta JSON
          const localData = await localRes.json();
          // Comprobación de que la extracción en el servidor fue exitosa
          if (localData && localData.success) {
            // Asignación de la tasa del dólar
            usdPrice = localData.usd;
            // Asignación de la tasa del euro
            eurPrice = localData.eur;
            // Asignación del texto oficial de Fecha Valor
            displayDateText = localData.fechaValor;
            // Normalización de la fecha corta para el historial
            historyDateStr = parseBcvDate(localData.fechaCorta);
            // Generación del identificador único de cambio
            rateSourceId = `bcv-${localData.rawUsd}-${localData.rawEur}-${localData.fechaValor}`;
          }
        }
      } catch (localErr) {
        // Si el endpoint local no está disponible (ej. en hosting estático externo), continúa silenciosamente
      }

      // 2. INTENTO SECUNDARIO: API CORS en tiempo real que scrapea directamente el BCV
      if (!usdPrice || !eurPrice) {
        try {
          // Controlador de aborto para la API secundaria
          const controller = new AbortController();
          // Temporizador de 6 segundos
          const timeoutId = setTimeout(() => controller.abort(), 6000);
          // Solicitud a la API de tiempo real
          const realtimeRes = await fetch(`${API_REALTIME_BCV}?t=${Date.now()}`, { signal: controller.signal });
          // Limpieza del temporizador
          clearTimeout(timeoutId);
          // Comprobación de respuesta HTTP OK
          if (realtimeRes.ok) {
            // Decodificación del arreglo JSON
            const list = await realtimeRes.json();
            // Verificación de formato array
            if (Array.isArray(list)) {
              // Búsqueda del registro de dólar
              const d = list.find((i) => i.currency === "dolar");
              // Búsqueda del registro de euro
              const e = list.find((i) => i.currency === "euro");
              // Si ambos registros están presentes
              if (d && e) {
                // Formateo de la tasa de dólar a 2 decimales
                usdPrice = Number(d.rate).toFixed(2);
                // Formateo de la tasa de euro a 2 decimales
                eurPrice = Number(e.rate).toFixed(2);
                // Creación de objeto Date con la fecha del registro
                const updateDate = new Date(d.date || Date.now());
                // Formateo del texto de fecha para la interfaz
                displayDateText = `Actualizado: ${updateDate.toLocaleString("es-VE", { dateStyle: "medium", timeStyle: "short" })}`;
                // Formato de fecha para el registro histórico
                historyDateStr = updateDate.toLocaleDateString("es-VE");
                // Generación de identificador de tasa
                rateSourceId = `realtime-${usdPrice}-${eurPrice}-${d.date}`;
              }
            }
          }
        } catch (realtimeErr) {
          // Si la API secundaria falla, pasa al siguiente respaldo
        }
      }

      // 3. INTENTO TERCIARIO DE RESPALDO: DolarApi Oficial
      if (!usdPrice || !eurPrice) {
        // Ejecución en paralelo de peticiones de respaldo
        const [usdResponse, eurResponse] = await Promise.all([
          fetch(`${API_FALLBACK_USD}?t=${Date.now()}`),
          fetch(`${API_FALLBACK_EUR}?t=${Date.now()}`),
        ]);

        // Validación de códigos de respuesta HTTP
        if (!usdResponse.ok || !eurResponse.ok) {
          throw new Error("Fallo en la comunicación con todas las fuentes de cotización");
        }

        // Decodificación de la respuesta del Dólar
        const usdData = await usdResponse.json();
        // Decodificación de la respuesta del Euro
        const eurData = await eurResponse.json();

        // Formateo de la tasa promedio del Dólar
        usdPrice = Number(usdData.promedio).toFixed(2);
        // Formateo de la tasa promedio del Euro
        eurPrice = Number(eurData.promedio).toFixed(2);

        // Fecha de actualización reportada
        const currentIso = usdData.fechaActualizacion || new Date().toISOString();
        // Conversión a objeto Date
        const updateDate = new Date(currentIso);
        // Formateo del texto de fecha
        displayDateText = `Actualizado: ${updateDate.toLocaleString("es-VE", { dateStyle: "medium", timeStyle: "short" })}`;
        // Fecha corta para el historial
        historyDateStr = updateDate.toLocaleDateString("es-VE");
        // Identificador de cambio
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

      // Se inyecta la fecha y hora formateada en el contenedor de fecha del HTML
      dateElement.textContent = displayDateText;

      // Si es una carga inicial o si se detectó una actualización oficial del BCV:
      if (hasChanged || !isBackground) {
        // Se guarda automáticamente el nuevo registro en el historial persistente
        saveToHistory(historyDateStr, formattedUsd, formattedEur);
      }
    } catch (error) {
      // Registro del error en la consola del desarrollador para diagnóstico
      console.error("Error al consultar tasas del BCV:", error);

      // Solo si fue una petición manual y los valores están vacíos mostramos error visual
      if (!isBackground && usdRateElement.textContent === "...") {
        // Muestra estado de error en la casilla del Dólar
        usdRateElement.textContent = "Error";

        // Muestra estado de error en la casilla del Euro
        eurRateElement.textContent = "Error";

        // Muestra un mensaje amigable al usuario indicando reintentar más tarde
        dateElement.textContent = "Intente de nuevo más tarde.";
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

  // Sincronización con el servidor para mantener actualizados los registros
  fetch("/api/history")
    .then((res) => res.json())
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

        if (localHistory.length > 0) {
          fetch("/api/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ history: merged }),
          }).catch(() => {});
        }
      }
    })
    .catch(() => {});

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
});
