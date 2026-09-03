// CONTROLADOR: SOLICITUD Y APERTURA DE CUENTAS

let supabaseClientCuentas = null;

// Referencias globales del DOM
let modalCuenta = null;
let formSolicitudCuenta = null;
let selectTipoCuenta = null;
let mensajeEstado = null;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Inicializar cliente de Supabase
    if (typeof CONFIG !== 'undefined' && CONFIG.URL_DE_SUPABASE && CONFIG.KEY_ANON_SUPABASE && window.supabase) {
        supabaseClientCuentas = window.supabase.createClient(CONFIG.URL_DE_SUPABASE, CONFIG.KEY_ANON_SUPABASE);
    }

    if (!supabaseClientCuentas) {
        console.error('💥 No se pudo inicializar el cliente de Supabase. Revisa config.example.js.');
        return;
    }

    // 2. Capturar elementos del DOM
    modalCuenta = document.getElementById('modalSolicitudCuenta');
    formSolicitudCuenta = document.getElementById('formSolicitudCuenta');
    selectTipoCuenta = document.getElementById('selectTipoCuenta');
    mensajeEstado = document.getElementById('mensajeEstado');

    // 3. Inicializar eventos del Modal
    setupModalEvents();

    // 4. Cargar catálogo dinámico de cuentas
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

    if (formSolicitudCuenta) {
        formSolicitudCuenta.addEventListener('submit', manejarEnvioSolicitud);
    }
}

function abrirModal(nombreProducto = '') {
    if (!modalCuenta) return;

    if (mensajeEstado) {
        mensajeEstado.textContent = '';
        mensajeEstado.className = 'mensaje-estado';
    }

    // Preselecciona el tipo de cuenta en el select si existe coincidencia
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
 * Trae el catálogo de cuentas activas desde la tabla productos_cuenta
 * y genera las tarjetas dinámicamente.
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
            return;
        }

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
                    <button class="btn-solicitar-cuenta" data-producto="${p.nombre}">
                        <i class="ri-add-line"></i> Solicitar Cuenta
                    </button>
                </div>
            </div>
        `).join('');

        // Evento de clic en cada tarjeta para desplegar el modal con los datos
        contenedor.querySelectorAll('.btn-solicitar-cuenta').forEach(boton => {
            boton.addEventListener('click', (e) => {
                const productoNombre = e.currentTarget.getAttribute('data-producto');
                abrirModal(productoNombre);
            });
        });

    } catch (err) {
        console.error('💥 Error al cargar las cuentas disponibles:', err);
        contenedor.innerHTML = "<p style='color:#ef4444;'>No se pudieron cargar las cuentas disponibles.</p>";
    }
}

/**
 * Obtiene el usuario en sesión (Supabase Auth o localStorage) y
 * registra la solicitud en solicitudes_productos.
 */
async function manejarEnvioSolicitud(e) {
    e.preventDefault();

    if (mensajeEstado) {
        mensajeEstado.style.color = '#0284c7';
        mensajeEstado.textContent = 'Enviando solicitud de apertura...';
    }

    // 1. Identificar al usuario en sesión
    let usuarioIdentificado = null;
    try {
        const { data: { session } } = await supabaseClientCuentas.auth.getSession();
        if (session && session.user) {
            usuarioIdentificado = session.user.email || session.user.id;
        }
    } catch (authErr) {
        console.warn('No se pudo verificar la sesión por Auth:', authErr);
    }

    // Respaldo por localStorage
    if (!usuarioIdentificado) {
        usuarioIdentificado = localStorage.getItem('usuarioActivo') || localStorage.getItem('usuario') || 'Usuario Sesión';
    }

    // 2. Obtener datos ingresados en el formulario
    const tipoCuenta = selectTipoCuenta ? selectTipoCuenta.value : '';
    const moneda = document.getElementById('monedaCuenta')?.value || 'GTQ';
    const montoInicial = parseFloat(document.getElementById('montoInicial')?.value) || 0;
    const proposito = document.getElementById('propositoCuenta')?.value || '';

    // 3. Insertar datos en Supabase
    try {
        const { error } = await supabaseClientCuentas
            .from('solicitudes_productos')
            .insert([{
                usuario: usuarioIdentificado,
                nombre_producto_solicitado: tipoCuenta,
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