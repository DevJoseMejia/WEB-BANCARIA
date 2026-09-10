/**
 * motion.js — Banco UVG
 * Utilidades de interfaz compartidas por todo el sitio (banca de clientes y
 * portal de colaboradores): tema claro/oscuro persistente, conteo animado
 * de montos y un helper para el estado de botones (reposo/cargando/listo).
 * No depende de ninguna página en particular y no toca lógica de negocio.
 */
(function () {
    "use strict";

    // La regla @view-transition de las hojas de estilo hace que el propio
    // navegador rechace una promesa interna con "Transition was skipped" en
    // la primera navegación a una página (no hay un documento anterior real
    // del que partir) -- es un artefacto conocido de la View Transitions API,
    // no un error del sitio. Se silencia solo esa firma exacta para no
    // ensuciar la consola; cualquier otro rechazo no manejado sigue
    // reportándose con normalidad.
    window.addEventListener("unhandledrejection", function (event) {
        var reason = event && event.reason;
        var message = (reason && reason.message) || String(reason || "");
        if (message.indexOf("Transition was skipped") !== -1) {
            event.preventDefault();
        }
    });

    var STORAGE_KEY = "uvg-theme";
    var root = document.documentElement;
    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ---------------------------------------------------------------
    // Tema claro / oscuro
    // ---------------------------------------------------------------
    function systemPrefersDark() {
        return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    }

    function refreshToggleButtons(theme) {
        var effective = theme || (systemPrefersDark() ? "dark" : "light");
        var buttons = document.querySelectorAll("[data-theme-toggle]");
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].setAttribute("aria-pressed", effective === "dark" ? "true" : "false");
            buttons[i].setAttribute("title", effective === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro");
        }
    }

    function applyTheme(theme) {
        if (theme === "light" || theme === "dark") {
            root.setAttribute("data-theme", theme);
        } else {
            root.removeAttribute("data-theme");
        }
        refreshToggleButtons(theme);
    }

    var savedTheme = null;
    try { savedTheme = localStorage.getItem(STORAGE_KEY); } catch (e) { /* almacenamiento no disponible */ }
    applyTheme(savedTheme);

    document.addEventListener("click", function (evt) {
        var btn = evt.target.closest ? evt.target.closest("[data-theme-toggle]") : null;
        if (!btn) return;
        var isDarkNow = root.getAttribute("data-theme") === "dark" ||
            (!root.getAttribute("data-theme") && systemPrefersDark());
        var next = isDarkNow ? "light" : "dark";
        applyTheme(next);
        try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* almacenamiento no disponible */ }
    });

    // ---------------------------------------------------------------
    // Conteo animado de montos (Q 12,450.00 -> cuenta desde cero)
    // Se activa solo en elementos marcados explícitamente con .money-live
    // ---------------------------------------------------------------
    function parseMoney(text) {
        var m = (text || "").trim().match(/^([A-Za-z$]{0,3}\s?)([\d.,]+)$/);
        if (!m) return null;
        var value = parseFloat(m[2].replace(/,/g, ""));
        if (isNaN(value)) return null;
        return { prefix: m[1], value: value };
    }

    function animateMoney(el, target, prefix) {
        if (reduceMotion) return;
        var duration = 800;
        var start = null;
        function step(ts) {
            if (!start) start = ts;
            var p = Math.min((ts - start) / duration, 1);
            var eased = 1 - Math.pow(1 - p, 3);
            el.textContent = prefix + (target * eased).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            if (p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }

    function enhanceMoneyWithin(scope) {
        var nodes = scope.querySelectorAll ? scope.querySelectorAll(".money-live") : [];
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            if (el.dataset.moneyDone) continue;
            var parsed = parseMoney(el.textContent);
            if (!parsed) continue;
            el.dataset.moneyDone = "1";
            animateMoney(el, parsed.value, parsed.prefix);
        }
    }

    // Contenedores cuyo contenido se reemplaza por JS (innerHTML) tras una
    // carga de datos: se observan para animar cualquier .money-live que
    // aparezca dentro, sin que cada página tenga que llamarlo a mano.
    var liveContainers = document.querySelectorAll(".money-live-container");
    for (var c = 0; c < liveContainers.length; c++) {
        (function (container) {
            var obs = new MutationObserver(function () { enhanceMoneyWithin(container); });
            obs.observe(container, { childList: true, subtree: true });
            enhanceMoneyWithin(container);
        })(liveContainers[c]);
    }
    enhanceMoneyWithin(document);

    // ---------------------------------------------------------------
    // Estado de botones: reposo -> cargando -> listo
    // Uso: UVGMotion.setButtonState(btn, "loading" | "done" | null)
    // Requiere que el botón tenga <span class="btn-spinner"></span> y que
    // el texto visible esté envuelto en <span class="btn-label-idle">.
    // ---------------------------------------------------------------
    function setButtonState(btn, state) {
        if (!btn) return;
        if (state) {
            btn.setAttribute("data-state", state);
        } else {
            btn.removeAttribute("data-state");
        }
        btn.disabled = state === "loading";
    }

    window.UVGMotion = {
        setButtonState: setButtonState,
        enhanceMoneyWithin: enhanceMoneyWithin
    };
})();
