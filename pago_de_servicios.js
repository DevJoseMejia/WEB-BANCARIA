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

    idUsuarioServicios = await resolverSesionCliente(supabaseClientServicios);
    if (!idUsuarioServicios) return; // resolverSesionCliente ya redirigió a login

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
        // El filtro corre primero para que la validación evalúe el valor ya limpio.
        inputIdentificador.addEventListener('input', () => {
            filtrarEscrituraIdentificador();
            validarIdentificador();
        });
    }

    // El monto no puede ser negativo, cero, ni superar el saldo de la cuenta.
    const inputMontoPago = document.getElementById('monto-pago');
    const selectCuentaOrigen = document.getElementById('cuenta-origen');
    if (inputMontoPago) {
        inputMontoPago.addEventListener('input', validarMontoPago);
    }
    if (selectCuentaOrigen) {
        selectCuentaOrigen.addEventListener('change', () => {
            pintarSaldoCuentaPago();
            validarMontoPago();
        });
    }

    const formPago = document.getElementById('form-pago-servicio');
    if (formPago) {
        formPago.addEventListener('submit', manejarSubmitPago);
    }
});

/** Muestra el saldo de la cuenta a debitar debajo del select. */
function pintarSaldoCuentaPago() {
    const select = document.getElementById('cuenta-origen');
    const hint = document.getElementById('ayudaCuentaOrigen');
    if (!select || !hint) return;

    const opcion = select.options[select.selectedIndex];
    const saldo = opcion ? parseFloat(opcion.dataset.saldo) : NaN;
    const moneda = opcion ? opcion.dataset.moneda : null;

    if (!isNaN(saldo)) {
        const simbolo = moneda === 'USD' ? '$' : 'Q';
        hint.textContent = `Saldo disponible: ${simbolo} ${saldo.toLocaleString('es-GT', { minimumFractionDigits: 2 })}`;
    } else {
        hint.textContent = '';
    }
}

/**
 * Reglas del monto: mayor a cero, con un tope razonable por operación y
 * nunca mayor al saldo real de la cuenta elegida.
 */
const MONTO_MAXIMO_PAGO = 50000;

function validarMontoPago() {
    const input = document.getElementById('monto-pago');
    const select = document.getElementById('cuenta-origen');
    if (!input) return;

    const monto = parseFloat(input.value);
    const opcion = select ? select.options[select.selectedIndex] : null;
    const saldo = opcion ? parseFloat(opcion.dataset.saldo) : NaN;
    const simbolo = opcion && opcion.dataset.moneda === 'USD' ? '$' : 'Q';

    if (input.value === '') {
        input.setCustomValidity('');
        return;
    }
    if (isNaN(monto) || monto <= 0) {
        input.setCustomValidity('El monto debe ser mayor a cero.');
    } else if (monto > MONTO_MAXIMO_PAGO) {
        input.setCustomValidity(`El monto máximo por pago es ${simbolo} ${MONTO_MAXIMO_PAGO.toLocaleString('es-GT')}.`);
    } else if (!isNaN(saldo) && monto > saldo) {
        input.setCustomValidity(`El monto supera el saldo disponible (${simbolo} ${saldo.toLocaleString('es-GT', { minimumFractionDigits: 2 })}).`);
    } else {
        input.setCustomValidity('');
    }
}

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
            contenedor.innerHTML = "<p style='color:var(--color-danger);'>No se pudo cargar el catálogo de servicios.</p>";
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
        contenedor.innerHTML = "<p style='color:var(--color-text-muted);'>No hay servicios en esta categoría.</p>";
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
        aplicarRestriccionesIdentificador(inputIdentificador, servicio);
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
 * Calcula cuántos caracteres puede tener como máximo un valor que cumpla el
 * patrón. Recorre el patrón átomo por átomo (una clase [..] completa, o un
 * carácter literal) y le suma el tope de su cuantificador.
 *
 * Se recorre en vez de contar con regex porque contar guiones a ciegas suma
 * los guiones de rango ("0-9" no es un guion literal, es un rango) e infla el
 * límite: [0-9]{6,10} debe dar 10, no 11.
 *
 * Devuelve 0 si el patrón está vacío o trae algo que no se sabe medir
 * (+, *, alternancias), para que el campo quede sin maxlength en vez de
 * cortar un valor válido.
 */
function largoMaximoDelPatron(patron) {
    if (!patron) return 0;

    const limpio = patron.replace(/^\^/, '').replace(/\$$/, '');
    if (/[+*|()]/.test(limpio)) return 0;

    let total = 0;
    let i = 0;

    while (i < limpio.length) {
        // 1. Delimitar el átomo: una clase [...] entera, un escape \d, o un literal.
        if (limpio[i] === '[') {
            const cierre = limpio.indexOf(']', i + 1);
            if (cierre === -1) return 0; // patrón mal formado: no arriesgarse
            i = cierre + 1;
        } else if (limpio[i] === '\\') {
            i += 2;
        } else {
            i += 1;
        }

        // 2. Ese átomo puede repetirse: {n}, {n,m} o ? (opcional).
        let repeticiones = 1;
        const cuantificador = /^\{(\d+)(?:,(\d+))?\}/.exec(limpio.slice(i));
        if (cuantificador) {
            repeticiones = parseInt(cuantificador[2] || cuantificador[1], 10);
            i += cuantificador[0].length;
        } else if (limpio[i] === '?') {
            i += 1; // opcional: en el peor caso aparece una vez
        }

        total += repeticiones;
    }

    return total;
}

/**
 * Deriva las restricciones de escritura del propio patrón del servicio
 * (catalogo_servicios.patron_regex) en vez de inventarlas:
 *   - Si el patrón solo admite dígitos (ej. el NIS/contador de luz o agua:
 *     [0-9]{6,10}), el campo se vuelve numérico y no deja teclear letras.
 *   - El largo máximo sale del propio cuantificador del patrón, así el
 *     contador de luz no puede pasar de 10 dígitos, el de agua tampoco, etc.
 *   - Si el patrón admite letras o guiones (contrato Tigo, placa, NIT, IUSI),
 *     se deja texto libre y solo se limita el largo.
 */
function aplicarRestriccionesIdentificador(input, servicio) {
    const patron = servicio.patron_regex || '';

    // Solo dígitos: el patrón se compone únicamente de clases [0-9] y sus
    // cuantificadores, sin letras ni separadores literales.
    const soloDigitos = /^(\[0-9\](\{\d+(,\d+)?\})?)+$/.test(patron.replace(/\s/g, ''));
    const maximo = largoMaximoDelPatron(patron);

    input.dataset.soloDigitos = soloDigitos ? '1' : '0';

    if (maximo > 0) {
        input.maxLength = maximo;
    } else {
        input.removeAttribute('maxlength');
    }

    if (soloDigitos) {
        input.inputMode = 'numeric';
        input.autocomplete = 'off';
    } else {
        input.removeAttribute('inputmode');
    }
}

/** Bloquea la escritura de caracteres no permitidos por el servicio elegido. */
function filtrarEscrituraIdentificador() {
    const input = document.getElementById('identificador-servicio');
    if (!input) return;

    if (input.dataset.soloDigitos === '1') {
        const limpio = input.value.replace(/\D/g, '');
        if (limpio !== input.value) input.value = limpio;
    }
    if (input.maxLength > 0 && input.value.length > input.maxLength) {
        input.value = input.value.slice(0, input.maxLength);
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

    if (btnSubmit && window.UVGMotion) window.UVGMotion.setButtonState(btnSubmit, 'loading');
    if (mensajeEstado) {
        mensajeEstado.style.color = 'var(--color-accent)';
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
                p_nombre_pagador: nombrePagador || null
            });

        if (error) throw error;

        if (btnSubmit && window.UVGMotion) window.UVGMotion.setButtonState(btnSubmit, 'done');

        const simbolo = opcionOrigen.dataset.moneda === 'USD' ? '$' : 'Q';
        const montoTexto = monto.toLocaleString('es-GT', { minimumFractionDigits: 2 });
        const codigo = (resultado && resultado.codigo_autorizacion) ? resultado.codigo_autorizacion : '—';

        if (mensajeEstado) {
            mensajeEstado.style.color = 'var(--color-success)';
            mensajeEstado.innerHTML = `¡Pago realizado con éxito! <span class="money-live">${simbolo} ${montoTexto}</span> a ${servicioSeleccionado.nombre}. Código de autorización: ${codigo}.`;
        }

        // Factura del pago, lista para descargar en PDF
        mostrarFactura({
            numero: 'FAC-' + codigo.replace(/^PAG-/, ''),
            fecha: new Date().toLocaleString('es-GT', { dateStyle: 'long', timeStyle: 'short' }),
            servicio: servicioSeleccionado.nombre,
            proveedor: servicioSeleccionado.proveedor,
            etiquetaIdentificador: (servicioSeleccionado.etiqueta_identificador || 'Identificador') + ':',
            identificador: inputIdentificador.value.trim(),
            cuenta: opcionOrigen.textContent.trim(),
            titular: nombrePagador || '—',
            autorizacion: codigo,
            montoTexto: `${simbolo} ${montoTexto}`
        });

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
            mensajeEstado.style.color = 'var(--color-danger)';
            mensajeEstado.textContent = 'Ocurrió un error al procesar el pago. Inténtalo de nuevo.';
        } else {
            alert('Ocurrió un error al procesar el pago. Inténtalo de nuevo.');
        }
        if (btnSubmit && window.UVGMotion) window.UVGMotion.setButtonState(btnSubmit, null);
    }
}
// ==========================================================================
// FACTURA DEL PAGO (modal + descarga en PDF)
// ==========================================================================

/** Llena y muestra la factura del pago recién aplicado. */
function mostrarFactura(datos) {
    const asignar = (id, valor) => {
        const el = document.getElementById(id);
        if (el) el.textContent = valor;
    };

    asignar('facNumero', datos.numero);
    asignar('facFecha', datos.fecha);
    asignar('facServicio', datos.servicio);
    asignar('facProveedor', datos.proveedor);
    asignar('facEtiquetaIdentificador', datos.etiquetaIdentificador);
    asignar('facIdentificador', datos.identificador);
    asignar('facCuenta', datos.cuenta);
    asignar('facTitular', datos.titular);
    asignar('facAutorizacion', datos.autorizacion);
    asignar('facMontoTotal', datos.montoTexto);
    asignar('facSubtotal', datos.montoTexto);
    asignar('facTotalDesglose', datos.montoTexto);

    const modal = document.getElementById('modalFactura');
    if (modal) modal.classList.add('active');
}

function cerrarFactura() {
    const modal = document.getElementById('modalFactura');
    if (modal) modal.classList.remove('active');
}

function descargarFacturaPDF() {
    const elemento = document.getElementById('areaFacturaPDF');
    const numero = (document.getElementById('facNumero') || {}).textContent || 'factura';

    if (typeof html2pdf === 'undefined') {
        alert('No se pudo cargar el generador de PDF. Revisa tu conexión e inténtalo de nuevo.');
        return;
    }

    html2pdf().set({
        margin: 0.5,
        filename: `${numero}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
    }).from(elemento).save();
}

document.addEventListener('DOMContentLoaded', () => {
    const btnDescargar = document.getElementById('btnDescargarFactura');
    const btnCerrar = document.getElementById('btnCerrarFactura');
    const modal = document.getElementById('modalFactura');

    if (btnDescargar) btnDescargar.addEventListener('click', descargarFacturaPDF);
    if (btnCerrar) btnCerrar.addEventListener('click', cerrarFactura);
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) cerrarFactura();
        });
    }
});
