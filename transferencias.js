// CONTROLADOR: TRANSFERENCIAS ENTRE CUENTAS (MISMO BANCO)
// + EVENTOS Y LÓGICA DE LOS MODALES: confirmación previa + comprobante

let supabaseClient = null;
let idUsuario = null;

document.addEventListener('DOMContentLoaded', async () => {

    // La sesión y el cierre se administran con Supabase Auth.
    if (typeof CONFIG !== 'undefined' && CONFIG.URL_DE_SUPABASE && CONFIG.KEY_ANON_SUPABASE && window.supabase) {
        supabaseClient = window.supabase.createClient(CONFIG.URL_DE_SUPABASE, CONFIG.KEY_ANON_SUPABASE);
    }

    if (!supabaseClient) {
        console.error('💥 No se pudo inicializar el cliente de Supabase. Revisa config.example.js.');
        return;
    }

    idUsuario = await resolverSesionCliente(supabaseClient);
    if (!idUsuario) return;

    // 4. Nombre del usuario en el header
    const elUserName = document.getElementById('userName');
    if (elUserName) {
        try {
            const { data: cliente, error } = await supabaseClient
                .from('perfiles_clientes')
                .select('nombres')
                .eq('id_usuario', idUsuario)
                .maybeSingle();
            if (error) throw error;
            if (cliente) elUserName.textContent = cliente.nombres;
        } catch (err) {
            console.error('💥 Error al cargar el nombre del usuario:', err);
        }
    }

    // 5. Cargar las cuentas reales del usuario en los tres selects de origen
    await cargarCuentasOrigen(idUsuario);

    // 6. Conectar el formulario "Mismo Banco" con su lógica de envío
    const formMismoBanco = document.getElementById('form-mismo-banco');
    if (formMismoBanco) {
        formMismoBanco.addEventListener('submit', manejarSubmitTransferencia);
    }

    // 7. Mostrar saldo disponible al cambiar de cuenta origen
    const selectOrigen = document.getElementById('mb-cuenta-origen');
    if (selectOrigen) {
        selectOrigen.addEventListener('change', actualizarSaldoDisponible);
    }

    // 7b. ACH (otros bancos locales) e Internacionales (SWIFT)
    await cargarBancosExternos();
    inicializarFormularioACH();
    inicializarFormularioInternacional();

    // 8. Wiring de los modales (confirmación previa + comprobante)
    const btnDescargar = document.getElementById('btnDescargarPDF');
    const btnCerrarComp = document.getElementById('btnCerrarComprobante');

    if (btnDescargar) {
        btnDescargar.addEventListener('click', descargarComprobantePDF);
    }
    if (btnCerrarComp) {
        btnCerrarComp.addEventListener('click', cerrarModalComprobante);
    }

    const modalConfirmar = document.getElementById('modalConfirmarTransferencia');
    if (modalConfirmar) {
        modalConfirmar.addEventListener('click', (e) => {
            if (e.target === modalConfirmar) {
                modalConfirmar.classList.remove('active');
                if (typeof resolverConfirmacionPendiente === 'function' && resolverConfirmacionPendiente) {
                    resolverConfirmacionPendiente(false);
                }
            }
        });
    }
});

/**
 * Trae las cuentas activas del usuario logueado y llena el <select> de
 * cuenta origen con datos reales (no estáticos).
 */
/** Los 3 selects de cuenta origen (mismo banco, ACH, internacional). */
const SELECTS_ORIGEN = ['mb-cuenta-origen', 'ach-cuenta-origen', 'int-cuenta-origen'];

function pintarOpcionesCuenta(selectId, cuentas) {
    const select = document.getElementById(selectId);
    if (!select) return;

    if (cuentas.length === 0) {
        select.innerHTML = '<option value="" disabled selected>No tienes cuentas activas</option>';
        return;
    }

    select.innerHTML = '<option value="" disabled selected>Selecciona cuenta de origen</option>' +
        cuentas.map(c => {
            const simbolo = c.moneda === 'USD' ? '$' : 'Q';
            const saldoFormateado = parseFloat(c.saldo_disponible).toLocaleString('es-GT', { minimumFractionDigits: 2 });
            return `<option value="${c.numero_cuenta}" data-saldo="${c.saldo_disponible}" data-moneda="${c.moneda}" data-tipo="${c.tipo_cuenta}">
                Cuenta ${c.tipo_cuenta} (No. ${c.numero_cuenta}) - ${simbolo} ${saldoFormateado}
            </option>`;
        }).join('');
}

/** Muestra el saldo de la cuenta elegida bajo cualquiera de los selects. */
function pintarSaldoHint(selectId, hintId) {
    const select = document.getElementById(selectId);
    const hint = document.getElementById(hintId);
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

async function cargarCuentasOrigen(idUsuarioActual) {
    const selectOrigen = document.getElementById('mb-cuenta-origen');
    if (!selectOrigen) return;

    try {
        const { data: cliente, error } = await supabaseClient
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
            .eq('id_usuario', idUsuarioActual)
            .maybeSingle();

        if (error) throw error;

        const cuentas = ((cliente && cliente.cuentas) || []).filter(c => c.estado === 'Activa');

        // Las mismas cuentas sirven para los tres tipos de transferencia.
        SELECTS_ORIGEN.forEach(id => pintarOpcionesCuenta(id, cuentas));

    } catch (err) {
        console.error('💥 Error al cargar cuentas de origen:', err);
        SELECTS_ORIGEN.forEach(id => {
            const s = document.getElementById(id);
            if (s) s.innerHTML = '<option value="" disabled selected>Error al cargar tus cuentas</option>';
        });
    }
}

function actualizarSaldoDisponible() {
    const selectOrigen = document.getElementById('mb-cuenta-origen');
    const hintSaldo = document.getElementById('mb-saldo-disponible');
    if (!selectOrigen || !hintSaldo) return;

    const opcion = selectOrigen.options[selectOrigen.selectedIndex];
    const saldo = opcion ? parseFloat(opcion.dataset.saldo) : NaN;
    const moneda = opcion ? opcion.dataset.moneda : null;

    if (!isNaN(saldo)) {
        const simbolo = moneda === 'USD' ? '$' : 'Q';
        const saldoFormateado = saldo.toLocaleString('es-GT', { minimumFractionDigits: 2 });
        // Solo el número queda envuelto en .money-live: el parser de motion.js
        // espera "PREFIJO NÚMERO" limpio, no la frase completa.
        hintSaldo.innerHTML = `Saldo disponible: <span class="money-live">${simbolo} ${saldoFormateado}</span>`;
    } else {
        hintSaldo.textContent = '';
    }
}

// Se reasigna en cada llamada a pedirConfirmacionModal() mientras el modal está abierto
let resolverConfirmacionPendiente = null;

async function manejarSubmitTransferencia(e) {
    e.preventDefault();

    const selectOrigen = document.getElementById('mb-cuenta-origen');
    const inputDestino = document.getElementById('mb-cuenta-destino');
    const inputMonto = document.getElementById('mb-monto');
    const inputConcepto = document.getElementById('mb-concepto');
    const btnSubmit = e.target.querySelector('button[type="submit"]');

    const opcionOrigen = selectOrigen.options[selectOrigen.selectedIndex];
    const cuentaOrigen = selectOrigen.value;
    const saldoOrigen = opcionOrigen ? parseFloat(opcionOrigen.dataset.saldo) : NaN;
    const monedaOrigen = opcionOrigen ? opcionOrigen.dataset.moneda : null;
    const tipoOrigen = opcionOrigen ? opcionOrigen.dataset.tipo : null;

    const cuentaDestino = inputDestino.value.trim();
    const monto = parseFloat(inputMonto.value);
    const motivo = inputConcepto.value.trim() || 'Sin motivo especificado';

    if (!cuentaOrigen || !cuentaDestino || cuentaDestino === cuentaOrigen || isNaN(monto) || monto <= 0) {
        alert('Revisa los datos ingresados en el formulario.');
        return;
    }

    if (!isNaN(saldoOrigen) && monto > saldoOrigen) {
        alert('El monto supera el saldo disponible.');
        return;
    }

    btnSubmit.disabled = true;
    const textoOriginalBtn = btnSubmit.innerHTML;
    btnSubmit.innerHTML = 'Verificando cuenta destino...';

    try {
        const { data: titularData, error: errTitular } = await supabaseClient
            .rpc('obtener_titular_cuenta', { p_numero_cuenta: cuentaDestino });

        if (errTitular || !titularData) {
            alert('La cuenta destino no existe o no se pudo validar.');
            return;
        }

        const titular = Array.isArray(titularData) ? titularData[0] : titularData;

        if (titular.estado !== 'Activa') {
            alert('La cuenta destino no está activa.');
            return;
        }

        const simbolo = monedaOrigen === 'USD' ? '$' : 'Q';
        const montoFormateado = monto.toLocaleString('es-GT', { minimumFractionDigits: 2 });

        // ANTES: aquí se usaba confirm() del navegador. Ahora se muestra un
        // modal propio con los datos de la transferencia y se espera a que
        // el usuario confirme o cancele.
        btnSubmit.innerHTML = 'Esperando confirmación...';

        const confirmado = await pedirConfirmacionModal({
            cuentaOrigenTexto: `${tipoOrigen || 'Cuenta'} (${cuentaOrigen})`,
            cuentaDestino: cuentaDestino,
            beneficiario: titular.nombre_completo,
            montoTexto: `${simbolo} ${montoFormateado}`,
            motivo: motivo
        });

        if (!confirmado) return;

        btnSubmit.innerHTML = 'Procesando transferencia...';

        const { data: resultado, error: errTransferencia } = await supabaseClient
            .rpc('realizar_transferencia_mismo_banco', {
                p_cuenta_origen: cuentaOrigen,
                p_cuenta_destino: cuentaDestino,
                p_monto: monto,
                p_motivo: motivo
            });

        if (errTransferencia) throw errTransferencia;

        // Preferimos el código de autorización que ahora genera y guarda la
        // propia RPC (queda registrado en `transacciones`); si por alguna
        // razón no viene en la respuesta, generamos uno solo para mostrar.
        const numReferencia = (resultado && resultado.codigo_autorizacion)
            ? resultado.codigo_autorizacion
            : 'REF-' + Math.floor(100000 + Math.random() * 900000);
        const fechaHora = new Date().toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'medium' });

        // La transferencia ya se ejecutó con éxito: cerramos el modal de
        // confirmación (que seguía abierto con el botón en "loading") y
        // marcamos el botón como "done" antes de mostrar el comprobante.
        const btnConfirmarTransferencia = document.getElementById('btnConfirmarTransferencia');
        if (window.UVGMotion) window.UVGMotion.setButtonState(btnConfirmarTransferencia, 'done');
        const modalConfirmarTransferencia = document.getElementById('modalConfirmarTransferencia');
        if (modalConfirmarTransferencia) modalConfirmarTransferencia.classList.remove('active');

        // Desplegar Pop-Out con la información requerida (comprobante final)
        mostrarModalComprobante({
            referencia: numReferencia,
            fecha: fechaHora,
            monto: `${simbolo} ${montoFormateado}`,
            cuentaOrigen: `${tipoOrigen || 'Cuenta'} (${cuentaOrigen})`,
            cuentaDestino: cuentaDestino,
            beneficiario: titular.nombre_completo,
            motivo: motivo
        });

        // Limpiar formulario y recargar cuentas
        document.getElementById('form-mismo-banco').reset();
        document.getElementById('mb-saldo-disponible').textContent = '';
        await cargarCuentasOrigen(idUsuario);

    } catch (err) {
        console.error('💥 Error en transferencia:', err);
        // Si el modal de confirmación seguía abierto con el botón en
        // "loading" (falló la llamada real a Supabase), lo regresamos a su
        // estado normal y cerramos el modal antes de avisar del error.
        const btnConfirmarTransferencia = document.getElementById('btnConfirmarTransferencia');
        if (window.UVGMotion) window.UVGMotion.setButtonState(btnConfirmarTransferencia, null);
        const modalConfirmarTransferencia = document.getElementById('modalConfirmarTransferencia');
        if (modalConfirmarTransferencia) modalConfirmarTransferencia.classList.remove('active');
        alert(err.message && err.message.includes('permiso')
            ? err.message
            : 'Ocurrió un error al procesar la transferencia.');
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = textoOriginalBtn;
    }
}

/**
 * Muestra el modal de confirmación previa con los datos de la transferencia
 * y devuelve una Promise que se resuelve en `true` (confirmó) o `false`
 * (canceló / cerró el modal), para poder usarse con await igual que el
 * confirm() nativo que reemplaza.
 */
function pedirConfirmacionModal(datos) {
    return new Promise((resolve) => {
        const modal = document.getElementById('modalConfirmarTransferencia');
        const btnConfirmar = document.getElementById('btnConfirmarTransferencia');
        const btnCancelar = document.getElementById('btnCancelarTransferencia');

        if (!modal || !btnConfirmar || !btnCancelar) {
            // Si por algún motivo el modal no existe en el HTML, no bloqueamos
            // el flujo -- mejor eso que dejar la transferencia colgada.
            console.error('No se encontró el modal de confirmación en el HTML.');
            resolve(true);
            return;
        }

        document.getElementById('confCuentaOrigen').textContent = datos.cuentaOrigenTexto;
        document.getElementById('confCuentaDestino').textContent = datos.cuentaDestino;
        document.getElementById('confBeneficiario').textContent = datos.beneficiario;
        document.getElementById('confMonto').textContent = datos.montoTexto;
        document.getElementById('confMotivo').textContent = datos.motivo;

        // Estado limpio cada vez que se abre el modal (por si quedó en
        // "loading"/"done" de una transferencia anterior en esta misma sesión).
        if (window.UVGMotion) window.UVGMotion.setButtonState(btnConfirmar, null);
        btnCancelar.disabled = false;

        function finalizar(resultado) {
            modal.classList.remove('active');
            btnConfirmar.removeEventListener('click', onConfirmar);
            btnCancelar.removeEventListener('click', onCancelar);
            resolverConfirmacionPendiente = null;
            resolve(resultado);
        }

        function onConfirmar() {
            // No cerramos el modal todavía: se queda abierto, con el botón en
            // estado "loading", mientras corre la llamada real a Supabase que
            // ejecuta la transferencia (en manejarSubmitTransferencia). Ese
            // mismo flujo es quien lo cierra al terminar (éxito o error).
            btnConfirmar.removeEventListener('click', onConfirmar);
            btnCancelar.removeEventListener('click', onCancelar);
            btnCancelar.disabled = true;
            resolverConfirmacionPendiente = null;
            if (window.UVGMotion) window.UVGMotion.setButtonState(btnConfirmar, 'loading');
            resolve(true);
        }
        function onCancelar() { finalizar(false); }

        resolverConfirmacionPendiente = finalizar;

        btnConfirmar.addEventListener('click', onConfirmar);
        btnCancelar.addEventListener('click', onCancelar);

        modal.classList.add('active');
    });
}

function mostrarModalComprobante(datos) {
    document.getElementById('compMonto').textContent = datos.monto;
    document.getElementById('compReferencia').textContent = datos.referencia;
    document.getElementById('compFecha').textContent = datos.fecha;
    document.getElementById('compOrigen').textContent = datos.cuentaOrigen;
    document.getElementById('compDestino').textContent = datos.cuentaDestino;
    document.getElementById('compBeneficiario').textContent = datos.beneficiario;
    document.getElementById('compMotivo').textContent = datos.motivo;

    const modal = document.getElementById('modalComprobante');
    if (modal) modal.classList.add('active');
}

function cerrarModalComprobante() {
    const modal = document.getElementById('modalComprobante');
    if (modal) modal.classList.remove('active');
}

function descargarComprobantePDF() {
    const elemento = document.getElementById('areaComprobantePDF');
    const numRef = document.getElementById('compReferencia').textContent;

    const opciones = {
        margin:       0.5,
        filename:     `comprobante_${numRef}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2 },
        jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
    };

    html2pdf().set(opciones).from(elemento).save();
}

// ==========================================================================
// TRANSFERENCIAS QUE SALEN DEL BANCO
// ACH  -> otros bancos locales (simulados en el proyecto servicios_bancos)
// SWIFT -> internacionales
// Ambas pasan por la Edge Function `transferencia-externa`, que es la única
// que puede tocar las dos bases de datos y revertir el débito si el abono
// externo falla.
// ==========================================================================

async function cargarBancosExternos() {
    const select = document.getElementById('ach-banco-destino');
    if (!select) return;

    if (typeof CONFIG_BANCOS_EXTERNOS === 'undefined' || !window.supabase) {
        select.innerHTML = '<option value="" disabled selected>No se pudo cargar el catálogo de bancos</option>';
        return;
    }

    try {
        const clienteExterno = window.supabase.createClient(
            CONFIG_BANCOS_EXTERNOS.URL_DE_SUPABASE,
            CONFIG_BANCOS_EXTERNOS.KEY_ANON_SUPABASE
        );

        const { data: bancos, error } = await clienteExterno
            .from('bancos_externos')
            .select('codigo, nombre')
            .eq('activo', true)
            .order('nombre');

        if (error) throw error;

        if (!bancos || bancos.length === 0) {
            select.innerHTML = '<option value="" disabled selected>No hay bancos disponibles</option>';
            return;
        }

        select.innerHTML = '<option value="" disabled selected>Selecciona el banco</option>' +
            bancos.map(b => `<option value="${b.codigo}">${b.nombre}</option>`).join('');

    } catch (err) {
        console.error('💥 Error al cargar bancos externos:', err);
        select.innerHTML = '<option value="" disabled selected>Error al cargar bancos</option>';
    }
}

function inicializarFormularioACH() {
    const form = document.getElementById('form-ach');
    if (!form) return;

    const selectOrigen = document.getElementById('ach-cuenta-origen');
    if (selectOrigen) {
        selectOrigen.addEventListener('change', () => pintarSaldoHint('ach-cuenta-origen', 'ach-saldo-disponible'));
    }

    // El número de cuenta interbancaria es solo dígitos.
    const inputCuenta = document.getElementById('ach-cuenta-num');
    if (inputCuenta) {
        inputCuenta.addEventListener('input', () => {
            inputCuenta.value = inputCuenta.value.replace(/\D/g, '').slice(0, 20);
        });
    }

    form.addEventListener('submit', manejarSubmitACH);
}

function inicializarFormularioInternacional() {
    const form = document.getElementById('form-internacional');
    if (!form) return;

    const selectOrigen = document.getElementById('int-cuenta-origen');
    if (selectOrigen) {
        selectOrigen.addEventListener('change', () => {
            pintarSaldoHint('int-cuenta-origen', 'int-saldo-disponible');
            // La etiqueta del monto sigue la moneda real de la cuenta elegida.
            const opcion = selectOrigen.options[selectOrigen.selectedIndex];
            const moneda = opcion ? opcion.dataset.moneda : null;
            const label = document.getElementById('int-monto-label');
            if (label && moneda) {
                label.textContent = moneda === 'USD' ? 'Monto en USD ($)' : 'Monto en Quetzales (Q)';
            }
        });
    }

    const inputSwift = document.getElementById('int-codigo-swift');
    if (inputSwift) {
        inputSwift.addEventListener('input', () => {
            inputSwift.value = inputSwift.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11);
        });
    }

    form.addEventListener('submit', manejarSubmitInternacional);
}

/** Envío común a la Edge Function, con manejo de estado del botón. */
async function enviarTransferenciaExterna(payload, boton) {
    if (window.UVGMotion) window.UVGMotion.setButtonState(boton, 'loading');
    try {
        const { data, error } = await supabaseClient.functions.invoke('transferencia-externa', { body: payload });

        // El cuerpo del error de una Edge Function viene dentro de la
        // respuesta, no en error.message -- hay que leerlo para poder
        // mostrarle al cliente el motivo real (saldo, cuenta inexistente...).
        if (error) {
            let detalle = 'No se pudo procesar la transferencia.';
            try {
                const cuerpo = await error.context?.json();
                if (cuerpo && cuerpo.error) detalle = cuerpo.error;
            } catch (_) { /* sin cuerpo legible */ }
            throw new Error(detalle);
        }
        if (data && data.error) throw new Error(data.error);
        return data;
    } finally {
        if (window.UVGMotion) window.UVGMotion.setButtonState(boton, null);
    }
}

async function manejarSubmitACH(e) {
    e.preventDefault();

    const boton = document.getElementById('btn-ach-submit');
    const selectOrigen = document.getElementById('ach-cuenta-origen');
    const selectBanco = document.getElementById('ach-banco-destino');
    const opcionOrigen = selectOrigen.options[selectOrigen.selectedIndex];

    const cuentaOrigen = selectOrigen.value;
    const codigoBanco = selectBanco.value;
    const titular = document.getElementById('ach-titular').value.trim();
    const cuentaDestino = document.getElementById('ach-cuenta-num').value.trim();
    const monto = parseFloat(document.getElementById('ach-monto').value);
    const saldo = opcionOrigen ? parseFloat(opcionOrigen.dataset.saldo) : NaN;
    const moneda = opcionOrigen ? opcionOrigen.dataset.moneda : 'GTQ';
    const tipoOrigen = opcionOrigen ? opcionOrigen.dataset.tipo : 'Cuenta';

    if (!cuentaOrigen || !codigoBanco || !titular || !cuentaDestino || isNaN(monto) || monto <= 0) {
        alert('Revisa los datos: cuenta origen, banco, titular, cuenta destino y monto son obligatorios.');
        return;
    }
    if (!isNaN(saldo) && monto > saldo) {
        alert('El monto supera el saldo disponible de la cuenta origen.');
        return;
    }

    const simbolo = moneda === 'USD' ? '$' : 'Q';
    const montoTexto = `${simbolo} ${monto.toLocaleString('es-GT', { minimumFractionDigits: 2 })}`;

    const confirmado = await pedirConfirmacionModal({
        cuentaOrigenTexto: `${tipoOrigen} (${cuentaOrigen})`,
        cuentaDestino: `${selectBanco.options[selectBanco.selectedIndex].textContent} / ${cuentaDestino}`,
        beneficiario: titular,
        montoTexto: montoTexto,
        motivo: 'Transferencia ACH interbancaria'
    });
    if (!confirmado) return;

    try {
        const resultado = await enviarTransferenciaExterna({
            tipo: 'ach',
            cuenta_origen: cuentaOrigen,
            codigo_banco: codigoBanco,
            cuenta_destino: cuentaDestino,
            titular_destino: titular,
            monto: monto,
            motivo: 'Transferencia ACH'
        }, boton);

        // Si el titular que escribió el cliente no coincide con el real del
        // banco destino, se avisa (la transferencia ya se hizo a la cuenta
        // indicada: el número de cuenta es lo que manda, igual que en un ACH real).
        if (resultado.titular_coincide === false) {
            alert(`Atención: la cuenta destino pertenece a "${resultado.titular_destino}", no a "${titular}". La transferencia se realizó a la cuenta indicada.`);
        }

        mostrarModalComprobante({
            referencia: resultado.codigo_autorizacion,
            fecha: new Date().toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'medium' }),
            monto: montoTexto,
            cuentaOrigen: `${tipoOrigen} (${cuentaOrigen})`,
            cuentaDestino: `${resultado.banco_destino} / ${cuentaDestino}`,
            beneficiario: resultado.titular_destino,
            motivo: 'Transferencia ACH interbancaria'
        });

        document.getElementById('form-ach').reset();
        document.getElementById('ach-saldo-disponible').textContent = '';
        await cargarCuentasOrigen(idUsuario);

    } catch (err) {
        console.error('💥 Error en ACH:', err);
        alert(err.message || 'Ocurrió un error al procesar la transferencia ACH.');
    }
}

async function manejarSubmitInternacional(e) {
    e.preventDefault();

    const boton = document.getElementById('btn-int-submit');
    const selectOrigen = document.getElementById('int-cuenta-origen');
    const opcionOrigen = selectOrigen.options[selectOrigen.selectedIndex];

    const cuentaOrigen = selectOrigen.value;
    const codigoSwift = document.getElementById('int-codigo-swift').value.trim().toUpperCase();
    const beneficiario = document.getElementById('int-beneficiario').value.trim();
    const monto = parseFloat(document.getElementById('int-monto').value);
    const saldo = opcionOrigen ? parseFloat(opcionOrigen.dataset.saldo) : NaN;
    const moneda = opcionOrigen ? opcionOrigen.dataset.moneda : 'GTQ';
    const tipoOrigen = opcionOrigen ? opcionOrigen.dataset.tipo : 'Cuenta';

    if (!cuentaOrigen || !codigoSwift || !beneficiario || isNaN(monto) || monto <= 0) {
        alert('Revisa los datos: cuenta origen, código SWIFT, beneficiario y monto son obligatorios.');
        return;
    }
    if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(codigoSwift)) {
        alert('El código SWIFT/BIC debe tener 8 u 11 caracteres (ej. BOFAUS3N).');
        return;
    }
    if (!isNaN(saldo) && monto > saldo) {
        alert('El monto supera el saldo disponible de la cuenta origen.');
        return;
    }

    const simbolo = moneda === 'USD' ? '$' : 'Q';
    const montoTexto = `${simbolo} ${monto.toLocaleString('es-GT', { minimumFractionDigits: 2 })}`;

    const confirmado = await pedirConfirmacionModal({
        cuentaOrigenTexto: `${tipoOrigen} (${cuentaOrigen})`,
        cuentaDestino: `SWIFT ${codigoSwift}`,
        beneficiario: beneficiario,
        montoTexto: montoTexto,
        motivo: 'Giro internacional (SWIFT)'
    });
    if (!confirmado) return;

    try {
        const resultado = await enviarTransferenciaExterna({
            tipo: 'swift',
            cuenta_origen: cuentaOrigen,
            codigo_swift: codigoSwift,
            beneficiario: beneficiario,
            monto: monto,
            motivo: 'Giro internacional'
        }, boton);

        mostrarModalComprobante({
            referencia: resultado.codigo_autorizacion,
            fecha: new Date().toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'medium' }),
            monto: montoTexto,
            cuentaOrigen: `${tipoOrigen} (${cuentaOrigen})`,
            cuentaDestino: `SWIFT ${codigoSwift}`,
            beneficiario: beneficiario,
            motivo: 'Giro internacional (SWIFT)'
        });

        document.getElementById('form-internacional').reset();
        document.getElementById('int-saldo-disponible').textContent = '';
        await cargarCuentasOrigen(idUsuario);

    } catch (err) {
        console.error('💥 Error en SWIFT:', err);
        alert(err.message || 'Ocurrió un error al procesar el giro internacional.');
    }
}
