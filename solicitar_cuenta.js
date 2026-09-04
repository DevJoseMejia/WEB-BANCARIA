// CONTROLADOR: SOLICITUD Y APERTURA DE CUENTAS

let supabaseClientCuentas = null;
let idUsuarioCuentas = null;

// Referencias globales del DOM
let modalCuenta = null;
let formSolicitudCuenta = null;
let selectTipoCuenta = null;
let mensajeEstado = null;

// Catálogo real cargado desde productos_cuenta, y la cuenta que se está solicitando
let catalogoCuentas = {}; // nombre -> registro completo
let cuentaSeleccionadaActual = { nombre: '', id: null };

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Inicializar cliente de Supabase
    if (typeof CONFIG !== 'undefined' && CONFIG.URL_DE_SUPABASE && CONFIG.KEY_ANON_SUPABASE && window.supabase) {
        supabaseClientCuentas = window.supabase.createClient(CONFIG.URL_DE_SUPABASE, CONFIG.KEY_ANON_SUPABASE);
    }

    if (!supabaseClientCuentas) {
        console.error('💥 No se pudo inicializar el cliente de Supabase. Revisa config.example.js.');
        return;
    }

    // 2. Usuario en sesión (mismo patrón que el resto del proyecto: sessionStorage/localStorage, no Supabase Auth)
    idUsuarioCuentas = sessionStorage.getItem('id_usuario') || localStorage.getItem('id_usuario');

    // 3. Capturar elementos del DOM
    modalCuenta = document.getElementById('modalSolicitudCuenta');
    formSolicitudCuenta = document.getElementById('formSolicitudCuenta');
    selectTipoCuenta = document.getElementById('selectTipoCuenta');
    mensajeEstado = document.getElementById('mensajeEstado');

    // 4. Inicializar eventos del Modal
    setupModalEvents();

    // 5. Cargar catálogo dinámico de cuentas (también llena el <select> del modal)
    await cargarCuentasDisponibles();
});

/**
 * Configura la apertura, cierre y envío del modal de solicitud.
 */
function setupModalEvents() {
    const btnCerrarModal = document.getElementById('btnCerrarModal');
    const btnCancelarModal = document.getElementById('btnCancelarModal');

    if (btnCerrarModal) btnCerrarModal.addEventListener('click', cerrarModal);
    if (btnCancelarModal) btnCancelarModal.addEventListener('click', cerrarModal);

    if (modalCuenta) {
        modalCuenta.addEventListener('click', (e) => {
            if (e.target === modalCuenta) cerrarModal();
        });
    }

    if (selectTipoCuenta) {
        selectTipoCuenta.addEventListener('change', () => {
            const producto = catalogoCuentas[selectTipoCuenta.value];
            cuentaSeleccionadaActual = producto ? { nombre: producto.nombre, id: producto.id } : { nombre: selectTipoCuenta.value, id: null };
        });
    }

    if (formSolicitudCuenta) {
        formSolicitudCuenta.addEventListener('submit', manejarEnvioSolicitud);
    }
}

function abrirModal(nombreProducto = '', idProducto = null) {
    if (!modalCuenta) return;

    if (mensajeEstado) {
        mensajeEstado.textContent = '';
        mensajeEstado.className = 'mensaje-estado';
    }

    cuentaSeleccionadaActual = { nombre: nombreProducto, id: idProducto };

    // El <select> ahora se puebla con los nombres reales del catálogo, así que sí hace match
    if (selectTipoCuenta && nombreProducto) {
        selectTipoCuenta.value = nombreProducto;
    }

    modalCuenta.style.display = 'flex';
    modalCuenta.classList.add('active');
}

function cerrarModal() {
    if (!modalCuenta) return;
    modalCuenta.style.display = 'none';
    modalCuenta.classList.remove('active');
    if (formSolicitudCuenta) formSolicitudCuenta.reset();
}

/**
 * Trae el catálogo de cuentas activas desde la tabla productos_cuenta,
 * genera las tarjetas dinámicamente y puebla el <select> del modal con
 * los MISMOS nombres reales (antes el select tenía 4 opciones inventadas
 * que no coincidían con el catálogo real, así que preseleccionar desde
 * una tarjeta nunca hacía match).
 */
async function cargarCuentasDisponibles() {
    const contenedor = document.getElementById('contenedorCuentasDisponibles');
    if (!contenedor) return;

    try {
        const { data: productos, error } = await supabaseClientCuentas
            .from('productos_cuenta')
            .select('*')
            .eq('activo', true)
            .order('orden', { ascending: true });

        if (error) throw error;

        if (!productos || productos.length === 0) {
            contenedor.innerHTML = "<p style='color:#64748b;'>No hay cuentas disponibles por el momento.</p>";
            if (selectTipoCuenta) selectTipoCuenta.innerHTML = '<option value="" disabled selected>No hay cuentas disponibles</option>';
            return;
        }

        catalogoCuentas = {};
        productos.forEach(p => { catalogoCuentas[p.nombre] = p; });

        // Construcción dinámica de tarjetas alineada al nuevo CSS
        contenedor.innerHTML = productos.map(p => `
            <div class="card-producto">
                <div class="card-producto-header">
                    <div class="card-producto-icon">
                        <i class="${p.icono || 'ri-bank-card-line'}"></i>
                    </div>
                    <span class="card-badge">${p.categoria || 'Cuenta'}</span>
                </div>
                <div class="card-producto-body">
                    <h3>${p.nombre}</h3>
                    <p>${p.descripcion}</p>
                    ${p.monto_minimo_apertura ? `<p><strong>Apertura mínima:</strong> GTQ ${p.monto_minimo_apertura}</p>` : ''}
                </div>
                <div class="card-producto-footer">
                    <button class="btn-solicitar-cuenta" data-producto="${p.nombre}" data-id="${p.id}">
                        <i class="ri-add-line"></i> Solicitar Cuenta
                    </button>
                </div>
            </div>
        `).join('');

        // <select> del modal, con los mismos nombres reales
        if (selectTipoCuenta) {
            selectTipoCuenta.innerHTML = '<option value="" disabled selected>Selecciona un tipo de cuenta</option>' +
                productos.map(p => `<option value="${p.nombre}">${p.nombre}</option>`).join('');
        }

        // Evento de clic en cada tarjeta para desplegar el modal con los datos
        contenedor.querySelectorAll('.btn-solicitar-cuenta').forEach(boton => {
            boton.addEventListener('click', (e) => {
                const productoNombre = e.currentTarget.getAttribute('data-producto');
                const productoId = e.currentTarget.getAttribute('data-id');
                abrirModal(productoNombre, productoId);
            });
        });

    } catch (err) {
        console.error('💥 Error al cargar las cuentas disponibles:', err);
        contenedor.innerHTML = "<p style='color:#ef4444;'>No se pudieron cargar las cuentas disponibles.</p>";
    }
}

/**
 * Registra la solicitud en solicitudes_cuentas (tabla dedicada, ya no
 * solicitudes_productos), usando el usuario real de la sesión.
 */
async function manejarEnvioSolicitud(e) {
    e.preventDefault();

    if (mensajeEstado) {
        mensajeEstado.style.color = '#0284c7';
        mensajeEstado.textContent = 'Enviando solicitud de apertura...';
    }

    const tipoCuenta = selectTipoCuenta ? selectTipoCuenta.value : '';
    const producto = catalogoCuentas[tipoCuenta];
    const moneda = document.getElementById('monedaCuenta')?.value || 'GTQ';
    const montoInicial = parseFloat(document.getElementById('montoInicial')?.value) || null;
    const proposito = document.getElementById('propositoCuenta')?.value || '';

    try {
        const { error } = await supabaseClientCuentas
            .from('solicitudes_cuentas')
            .insert([{
                id_usuario: idUsuarioCuentas,
                id_producto_cuenta: producto ? producto.id : (cuentaSeleccionadaActual.id || null),
                nombre_producto: tipoCuenta,
                moneda: moneda,
                monto_inicial: montoInicial,
                proposito: proposito,
                estado: 'Pendiente',
                fecha_solicitud: new Date().toISOString()
            }]);

        if (error) throw error;

        if (mensajeEstado) {
            mensajeEstado.style.color = '#16a34a';
            mensajeEstado.textContent = '¡Solicitud registrada con éxito! Un ejecutivo procesará tu apertura.';
        }

        setTimeout(() => {
            cerrarModal();
        }, 2000);

    } catch (err) {
        console.error('Error al guardar la solicitud en la base de datos:', err);
        if (mensajeEstado) {
            mensajeEstado.style.color = '#dc2626';
            mensajeEstado.textContent = 'Ocurrió un error al enviar la solicitud. Inténtalo de nuevo.';
        }
    }
}