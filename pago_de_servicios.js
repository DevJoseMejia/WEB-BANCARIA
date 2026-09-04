// CONTROLADOR: PAGO DE SERVICIOS

let supabaseClientServicios = null;
let todosLosServicios = [];      // cache de todos los servicios cargados del catálogo
let servicioSeleccionado = null; // servicio actualmente elegido por el usuario
let idUsuarioServicios = null;
let nombrePagador = '';          // nombres + apellidos del usuario en sesión

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof CONFIG !== 'undefined' && CONFIG.URL_DE_SUPABASE && CONFIG.KEY_ANON_SUPABASE && window.supabase) {
        supabaseClientServicios = window.supabase.createClient(CONFIG.URL_DE_SUPABASE, CONFIG.KEY_ANON_SUPABASE);
    }

    if (!supabaseClientServicios) {
        console.error('💥 No se pudo inicializar el cliente de Supabase. Revisa config.example.js.');
        return;
    }

    idUsuarioServicios = sessionStorage.getItem('id_usuario') || localStorage.getItem('id_usuario');

    await Promise.all([
        cargarServicios(),
        cargarCuentasOrigenServicio(),
        cargarDatosPagador()
    ]);

    // Filtros de categoría (Todos / Luz y Agua / Internet y TV / Impuestos y Arbitrios)
    document.querySelectorAll('.btn-filtro-servicio').forEach(boton => {
        boton.addEventListener('click', () => {
            document.querySelectorAll('.btn-filtro-servicio').forEach(b => b.classList.remove('active'));
            boton.classList.add('active');
            renderizarServicios(boton.dataset.categoria || null);
        });
    });

    const inputIdentificador = document.getElementById('identificador-servicio');
    if (inputIdentificador) {
        inputIdentificador.addEventListener('input', validarIdentificador);
    }

    const formPago = document.getElementById('form-pago-servicio');
    if (formPago) {
        formPago.addEventListener('submit', manejarSubmitPago);
    }
});

/**
 * Trae el catálogo completo de servicios activos desde Supabase, ahora
 * incluyendo el formato/regex real de cada correlativo (columnas nuevas
 * en catalogo_servicios: formato_identificador, patron_regex, ejemplo_identificador).
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
 * Trae nombre+apellidos del usuario en sesión (perfiles_clientes), para
 * mostrarlos en el formulario y guardarlos junto con cada pago.
 */
async function cargarDatosPagador() {
    const infoPagador = document.getElementById('infoPagador');
    if (!idUsuarioServicios) return;

    try {
        const { data: perfil, error } = await supabaseClientServicios
            .from('perfiles_clientes')
            .select('nombres, apellidos')
            .eq('id_usuario', idUsuarioServicios)
            .maybeSingle();

        if (error) throw error;

        if (perfil) {
            nombrePagador = `${perfil.nombres} ${perfil.apellidos}`;
            if (infoPagador) infoPagador.textContent = `Vas a pagar como: ${nombrePagador}`;
        }

    } catch (err) {
        console.error('💥 Error al cargar los datos del pagador:', err);
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
 * cambia el label/placeholder del identificador, aplica el patrón de
 * validación real de ese correlativo, muestra qué se está pagando, y
 * habilita los campos (estaban deshabilitados hasta elegir).
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
    const ayudaIdentificador = document.getElementById('ayudaIdentificador');
    const etiqueta = servicio.etiqueta_identificador || 'Número de identificador';

    if (labelIdentificador) labelIdentificador.textContent = etiqueta;
    if (inputIdentificador) {
        inputIdentificador.placeholder = servicio.ejemplo_identificador ? `Ej. ${servicio.ejemplo_identificador}` : `Ej. ${etiqueta}`;
        inputIdentificador.value = '';
        inputIdentificador.setCustomValidity('');
    }
    if (ayudaIdentificador) {
        ayudaIdentificador.textContent = servicio.formato_identificador
            ? `Formato: ${servicio.formato_identificador}`
            : '';
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
 * Valida en vivo el identificador ingresado contra el patrón real del
 * servicio elegido (catalogo_servicios.patron_regex), con un mensaje
 * de error entendible en vez del genérico del navegador.
 */
function validarIdentificador() {
    const inputIdentificador = document.getElementById('identificador-servicio');
    if (!inputIdentificador || !servicioSeleccionado) return;

    const patron = servicioSeleccionado.patron_regex;
    if (!patron) {
        inputIdentificador.setCustomValidity('');
        return;
    }

    const regex = new RegExp(`^(?:${patron})$`);
    if (inputIdentificador.value && !regex.test(inputIdentificador.value.trim())) {
        const formato = servicioSeleccionado.formato_identificador || 'el formato requerido por el servicio';
        inputIdentificador.setCustomValidity(`El identificador no tiene el formato esperado. ${formato}.`);
    } else {
        inputIdentificador.setCustomValidity('');
    }
}

/**
 * Carga las cuentas activas del usuario logueado en el select de
 * "Cuenta a debitar", igual que hicimos en transferencias.js.
 */
async function cargarCuentasOrigenServicio() {
    const selectOrigen = document.getElementById('cuenta-origen');
    if (!selectOrigen) return;

    if (!idUsuarioServicios) return; // sesion_comun.js ya se encarga de redirigir a Login

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
            .eq('id_usuario', idUsuarioServicios)
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
 * Envío del formulario: valida todo, incluyendo el correlativo contra el
 * patrón real del servicio, y llama a la RPC realizar_pago_servicio, que
 * debita el saldo y registra el pago de forma atómica (mismo patrón que
 * las transferencias).
 */
async function manejarSubmitPago(e) {
    e.preventDefault();

    const mensajeEstado = document.getElementById('mensajeEstadoPago');
    const btnSubmit = e.target.querySelector('button[type="submit"]');

    if (!servicioSeleccionado) {
        alert('Selecciona un servicio antes de continuar.');
        return;
    }

    const selectOrigen = document.getElementById('cuenta-origen');
    const inputIdentificador = document.getElementById('identificador-servicio');
    const inputMonto = document.getElementById('monto-pago');
    const inputAlias = document.getElementById('concepto');

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

    validarIdentificador();
    if (!inputIdentificador.checkValidity()) {
        inputIdentificador.reportValidity();
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

    if (btnSubmit) {
        btnSubmit.disabled = true;
        var textoOriginalBtn = btnSubmit.innerHTML;
        btnSubmit.innerHTML = 'Procesando pago...';
    }
    if (mensajeEstado) {
        mensajeEstado.style.color = '#0284c7';
        mensajeEstado.textContent = 'Procesando tu pago...';
    }

    try {
        const { data: resultado, error } = await supabaseClientServicios
            .rpc('realizar_pago_servicio', {
                p_cuenta_origen: selectOrigen.value,
                p_monto: monto,
                p_id_servicio: servicioSeleccionado.id_servicio,
                p_nombre_servicio: servicioSeleccionado.nombre,
                p_proveedor: servicioSeleccionado.proveedor,
                p_identificador: inputIdentificador.value.trim(),
                p_alias: inputAlias.value.trim() || null,
                p_id_usuario: idUsuarioServicios,
                p_nombre_pagador: nombrePagador || null
            });

        if (error) throw error;

        const simbolo = opcionOrigen.dataset.moneda === 'USD' ? '$' : 'Q';
        const montoTexto = monto.toLocaleString('es-GT', { minimumFractionDigits: 2 });
        const codigo = (resultado && resultado.codigo_autorizacion) ? resultado.codigo_autorizacion : '—';

        if (mensajeEstado) {
            mensajeEstado.style.color = '#16a34a';
            mensajeEstado.textContent = `¡Pago realizado con éxito! ${simbolo} ${montoTexto} a ${servicioSeleccionado.nombre}. Código de autorización: ${codigo}.`;
        }

        document.getElementById('form-pago-servicio').reset();
        servicioSeleccionado = null;
        document.querySelectorAll('.card-proveedor').forEach(c => c.classList.remove('activo-card'));
        const textoServicio = document.getElementById('servicioSeleccionadoTexto');
        if (textoServicio) textoServicio.textContent = 'Selecciona un servicio arriba para continuar.';

        // Recargar el saldo de las cuentas (ya quedó debitado)
        await cargarCuentasOrigenServicio();

    } catch (err) {
        console.error('💥 Error al procesar el pago:', err);
        if (mensajeEstado) {
            mensajeEstado.style.color = '#dc2626';
            mensajeEstado.textContent = 'Ocurrió un error al procesar el pago. Inténtalo de nuevo.';
        } else {
            alert('Ocurrió un error al procesar el pago. Inténtalo de nuevo.');
        }
    } finally {
        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = textoOriginalBtn;
        }
    }
}