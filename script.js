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

  // Endpoint oficial para obtener la cotización del Dólar Oficial del Banco Central de Venezuela
  const API_USD = "https://ve.dolarapi.com/v1/dolares/oficial";

  // Endpoint oficial para obtener la cotización del Euro Oficial del Banco Central de Venezuela
  const API_EUR = "https://ve.dolarapi.com/v1/euros/oficial";

  // Intervalo de tiempo para la comprobación automática en segundo plano (60 segundos = 60000 ms)
  const AUTO_REFRESH_INTERVAL_MS = 60000;

  // Variable en memoria para registrar la última fecha ISO oficial emitida por el BCV
  let lastOfficialDateIso = "";

  // Variable en memoria para registrar el último precio del dólar consultado
  let lastUsdPrice = "";

  // Variable en memoria para registrar el último precio del euro consultado
  let lastEurPrice = "";

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

      // Se ejecutan ambas solicitudes HTTP en paralelo añadiendo timestamp para evitar caché
      const [usdResponse, eurResponse] = await Promise.all([
        fetch(`${API_USD}?t=${Date.now()}`),
        fetch(`${API_EUR}?t=${Date.now()}`),
      ]);

      // Si alguna de las dos respuestas HTTP no es satisfactoria (código 200-299), se genera un error
      if (!usdResponse.ok || !eurResponse.ok) {
        throw new Error("Fallo en la comunicación con la API del BCV");
      }

      // Se decodifica la respuesta JSON del endpoint del Dólar
      const usdData = await usdResponse.json();

      // Se decodifica la respuesta JSON del endpoint del Euro
      const eurData = await eurResponse.json();

      // Se formatea la tasa promedio del Dólar asegurando 2 decimales fijos
      const usdPrice = Number(usdData.promedio).toFixed(2);

      // Se formatea la tasa promedio del Euro asegurando 2 decimales fijos
      const eurPrice = Number(eurData.promedio).toFixed(2);

      // Se almacena la fecha de actualización reportada por el BCV
      const currentIso = usdData.fechaActualizacion || new Date().toISOString();

      // Se convierte la cadena ISO de fecha a un objeto nativo Date de JavaScript
      const updateDate = new Date(currentIso);

      // Se formatea la fecha y hora al estándar venezolano ("es-VE")
      const dateString = updateDate.toLocaleString("es-VE", {
        dateStyle: "medium",
        timeStyle: "short",
      });

      // Se comprueba si hubo algún cambio con respecto a los datos previos registrados
      const hasChanged =
        currentIso !== lastOfficialDateIso ||
        usdPrice !== lastUsdPrice ||
        eurPrice !== lastEurPrice;

      // Se actualizan los valores de referencia en memoria
      lastOfficialDateIso = currentIso;
      lastUsdPrice = usdPrice;
      lastEurPrice = eurPrice;

      // Se inyecta la tasa formateada del Dólar en el elemento correspondiente del HTML
      usdRateElement.textContent = `Bs. ${usdPrice}`;

      // Se inyecta la tasa formateada del Euro en el elemento correspondiente del HTML
      eurRateElement.textContent = `Bs. ${eurPrice}`;

      // Se inyecta la fecha y hora formateada en el contenedor de fecha del HTML
      dateElement.textContent = `Actualizado: ${dateString}`;

      // Si es una carga inicial o si se detectó una actualización oficial del BCV:
      if (hasChanged || !isBackground) {
        // Se guarda automáticamente el nuevo registro en el historial persistente
        saveToHistory(updateDate, usdPrice, eurPrice);
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
  function saveToHistory(dateObj, usd, eur) {
    // Se extrae la representación del día (ej. "11/9/2026") para identificar la jornada
    const dayString = dateObj.toLocaleDateString("es-VE");

    // Se obtiene el historial existente almacenado en localStorage o se crea un arreglo vacío
    let history = JSON.parse(localStorage.getItem("bcv_history")) || [];

    // Se busca si ya existe un registro almacenado con la misma fecha
    const todayIndex = history.findIndex((item) => item.date === dayString);

    // Objeto estructurado que almacena la fecha, la tasa de USD y la tasa de EUR
    const newRecord = { date: dayString, usd: usd, eur: eur };

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

    // Se invoca la función para redibujar visualmente el listado de historial en la interfaz
    renderHistory();
  }

  // Función encargada de dibujar en el DOM los elementos de la lista del historial
  function renderHistory() {
    // Se recuperan los datos guardados en localStorage o se inicializa con un arreglo vacío
    const history = JSON.parse(localStorage.getItem("bcv_history")) || [];

    // Se vacía el contenido previo de la lista HTML para evitar duplicidades visuales
    historyList.innerHTML = "";

    // Si el arreglo no contiene registros, se muestra un mensaje informativo
    if (history.length === 0) {
      historyList.innerHTML =
        "<li class='history-item'>No hay historial aún</li>";
      return;
    }

    // Se itera sobre cada uno de los registros del historial para generar sus filas
    history.forEach((item) => {
      // Se crea un nuevo elemento <li> en memoria
      const li = document.createElement("li");

      // Se le asigna la clase CSS 'history-item' para aplicar el formato correspondiente
      li.className = "history-item";

      // Se define el contenido HTML interno con la fecha a la izquierda y las cotizaciones con banderas
      li.innerHTML = `
        <span class="history-date">${item.date}</span>
        <span class="history-values">🇺🇸 ${item.usd} | 🇪🇺 ${item.eur}</span>
      `;

      // Se añade el elemento <li> hijo al contenedor de lista <ul>
      historyList.appendChild(li);
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
