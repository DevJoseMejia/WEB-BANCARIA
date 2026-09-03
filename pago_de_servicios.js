// CONTROLADOR: PAGO DE SERVICIOS

let supabaseClientServicios = null;
let todosLosServicios = [];      // cache de todos los servicios cargados del catálogo
let servicioSeleccionado = null; // servicio actualmente elegido por el usuario

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof CONFIG !== 'undefined' && CONFIG.URL_DE_SUPABASE && CONFIG.KEY_ANON_SUPABASE && window.supabase) {
        supabaseClientServicios = window.supabase.createClient(CONFIG.URL_DE_SUPABASE, CONFIG.KEY_ANON_SUPABASE);
    }

    if (!supabaseClientServicios) {
        console.error('💥 No se pudo inicializar el cliente de Supabase. Revisa config.example.js.');
        return;
    }

    await cargarServicios();
    await cargarCuentasOrigenServicio();

    // Filtros de categoría (Todos / Luz y Agua / Internet y TV / Impuestos y Arbitrios)
    document.querySelectorAll('.btn-filtro-servicio').forEach(boton => {
        boton.addEventListener('click', () => {
            document.querySelectorAll('.btn-filtro-servicio').forEach(b => b.classList.remove('active'));
            boton.classList.add('active');
            renderizarServicios(boton.dataset.categoria || null);
        });
    });

    const formPago = document.getElementById('form-pago-servicio');
    if (formPago) {
        formPago.addEventListener('submit', manejarSubmitPago);
    }
});

/**
 * Trae el catálogo completo de servicios activos desde Supabase.
 */
async function cargarServicios() {
    try {
        const { data, error } = await supabaseClientServicios
            .from('catalogo_servicios')
            .select('*')
            .eq('activo', true)
            .order('orden', { ascending: true });

        if (error) throw error;

        todosLosServicios = data || [];
        renderizarServicios(null);

    } catch (err) {
        console.error('💥 Error al cargar el catálogo de servicios:', err);
        const contenedor = document.getElementById('contenedorServicios');
        if (contenedor) {
            contenedor.innerHTML = "<p style='color:#ef4444;'>No se pudo cargar el catálogo de servicios.</p>";
        }
    }
}

/**
 * Dibuja las tarjetas de servicio (filtradas por categoría si se indica)
 * y engancha el clic de selección en cada una.
 */
function renderizarServicios(categoria) {
    const contenedor = document.getElementById('contenedorServicios');
    if (!contenedor) return;

    const lista = categoria ? todosLosServicios.filter(s => s.categoria === categoria) : todosLosServicios;

    if (lista.length === 0) {
        contenedor.innerHTML = "<p style='color:#64748b;'>No hay servicios en esta categoría.</p>";
        return;
    }

    contenedor.innerHTML = lista.map(s => `
        <div class="card-proveedor" data-id-servicio="${s.id_servicio}">
            <div class="icono-proveedor">
                <i class="${s.icono || 'ri-service-line'}"></i>
            </div>
            <div class="info-proveedor">
                <h3>${s.nombre}</h3>
                <p>${s.proveedor}</p>
            </div>
        </div>
    `).join('');

    contenedor.querySelectorAll('.card-proveedor').forEach(card => {
        card.addEventListener('click', () => {
            const idServicio = card.getAttribute('data-id-servicio');
            const servicio = todosLosServicios.find(s => s.id_servicio === idServicio);
            if (servicio) seleccionarServicio(servicio, card);
        });
    });

    // Si el servicio que ya estaba seleccionado sigue visible en esta
    // categoría, lo volvemos a marcar como activo tras redibujar
    if (servicioSeleccionado) {
        const cardActual = contenedor.querySelector(`[data-id-servicio="${servicioSeleccionado.id_servicio}"]`);
        if (cardActual) cardActual.classList.add('activo-card');
    }
}

/**
 * Marca el servicio elegido y adapta el formulario a ese servicio:
 * cambia el label/placeholder del identificador, muestra qué se está
 * pagando, y habilita los campos (estaban deshabilitados hasta elegir).
 */
function seleccionarServicio(servicio, cardElement) {
    servicioSeleccionado = servicio;

    document.querySelectorAll('.card-proveedor').forEach(c => c.classList.remove('activo-card'));
    if (cardElement) cardElement.classList.add('activo-card');

    const textoServicio = document.getElementById('servicioSeleccionadoTexto');
    if (textoServicio) {
        textoServicio.textContent = `Estás pagando: ${servicio.nombre} (${servicio.proveedor})`;
    }

    const labelIdentificador = document.getElementById('labelIdentificadorServicio');
    const inputIdentificador = document.getElementById('identificador-servicio');
    const etiqueta = servicio.etiqueta_identificador || 'Número de identificador';

    if (labelIdentificador) labelIdentificador.textContent = etiqueta;
    if (inputIdentificador) {
        inputIdentificador.placeholder = `Ej. ${etiqueta}`;
        inputIdentificador.value = '';
    }

    // Habilitamos el resto del formulario ahora que hay un servicio elegido
    const formPago = document.getElementById('form-pago-servicio');
    if (formPago) {
        formPago.querySelectorAll('input, select, button[type="submit"]').forEach(el => {
            // La cuenta origen se habilita solo si ya cargó opciones reales
            if (el.id === 'cuenta-origen' && el.options.length <= 1 && el.options[0]?.disabled) return;
            el.disabled = false;
        });
    }
}

/**
 * Carga las cuentas activas del usuario logueado en el select de
 * "Cuenta a debitar", igual que hicimos en transferencias.js.
 */
async function cargarCuentasOrigenServicio() {
    const selectOrigen = document.getElementById('cuenta-origen');
    if (!selectOrigen) return;

    const idUsuario = sessionStorage.getItem('id_usuario') || localStorage.getItem('id_usuario');
    if (!idUsuario) return; // sesion_comun.js ya se encarga de redirigir a Login

    try {
        const { data: cliente, error } = await supabaseClientServicios
            .from('perfiles_clientes')
            .select(`
                cuentas (
                    numero_cuenta,
                    tipo_cuenta,
                    saldo_disponible,
                    moneda,
                    estado
                )
            `)
            .eq('id_usuario', idUsuario)
            .maybeSingle();

        if (error) throw error;

        const cuentas = ((cliente && cliente.cuentas) || []).filter(c => c.estado === 'Activa');

        if (cuentas.length === 0) {
            selectOrigen.innerHTML = '<option value="" disabled selected>No tienes cuentas activas</option>';
            return;
        }

        selectOrigen.innerHTML = '<option value="" disabled selected>Selecciona una cuenta</option>' +
            cuentas.map(c => {
                const simbolo = c.moneda === 'USD' ? '$' : 'Q';
                const saldoFormateado = parseFloat(c.saldo_disponible).toLocaleString('es-GT', { minimumFractionDigits: 2 });
                return `<option value="${c.numero_cuenta}" data-saldo="${c.saldo_disponible}" data-moneda="${c.moneda}">
                    Cuenta ${c.tipo_cuenta} (No. ${c.numero_cuenta}) - ${simbolo} ${saldoFormateado}
                </option>`;
            }).join('');

        // Si ya hay un servicio elegido, habilitamos el select ahora que tiene datos reales
        if (servicioSeleccionado) selectOrigen.disabled = false;

    } catch (err) {
        console.error('💥 Error al cargar cuentas de origen:', err);
        selectOrigen.innerHTML = '<option value="" disabled selected>Error al cargar tus cuentas</option>';
    }
}

/**
 * Validación del envío. NOTA: por ahora esto NO debita saldo ni registra
 * la transacción en la base de datos -- solo valida y confirma. El
 * procesamiento real del pago (débito + registro, de forma atómica)
 * queda pendiente como siguiente paso, igual que hicimos con
 * transferencias.js vía un RPC.
 */
function manejarSubmitPago(e) {
    e.preventDefault();

    if (!servicioSeleccionado) {
        alert('Selecciona un servicio antes de continuar.');
        return;
    }

    const selectOrigen = document.getElementById('cuenta-origen');
    const inputIdentificador = document.getElementById('identificador-servicio');
    const inputMonto = document.getElementById('monto-pago');

    const opcionOrigen = selectOrigen.options[selectOrigen.selectedIndex];
    const saldoOrigen = opcionOrigen ? parseFloat(opcionOrigen.dataset.saldo) : NaN;
    const monto = parseFloat(inputMonto.value);

    if (!selectOrigen.value) {
        alert('Selecciona la cuenta que quieres debitar.');
        return;
    }
    if (!inputIdentificador.value.trim()) {
        alert('Ingresa el identificador del servicio.');
        return;
    }
    if (isNaN(monto) || monto <= 0) {
        alert('Ingresa un monto válido mayor a 0.');
        return;
    }
    if (!isNaN(saldoOrigen) && monto > saldoOrigen) {
        alert('El monto supera el saldo disponible de la cuenta seleccionada.');
        return;
    }

    const simbolo = opcionOrigen.dataset.moneda === 'USD' ? '$' : 'Q';
    alert(
        `Validación correcta: pagarías ${simbolo} ${monto.toLocaleString('es-GT', { minimumFractionDigits: 2 })} ` +
        `a ${servicioSeleccionado.nombre} (${servicioSeleccionado.proveedor}). ` +
        `El procesamiento real del pago se conectará en el siguiente paso.`
    );
}