// EVENTOS Y LÓGICA DE LOS MODALES: confirmación previa + comprobante
document.addEventListener('DOMContentLoaded', () => {
    const btnDescargar = document.getElementById('btnDescargarPDF');
    const btnCerrar = document.getElementById('btnCerrarComprobante');

    if (btnDescargar) {
        btnDescargar.addEventListener('click', descargarComprobantePDF);
    }
    if (btnCerrar) {
        btnCerrar.addEventListener('click', cerrarModalComprobante);
    }

    // Cerrar el modal de confirmación si se hace clic fuera del recuadro
    const modalConfirmar = document.getElementById('modalConfirmarTransferencia');
    if (modalConfirmar) {
        modalConfirmar.addEventListener('click', (e) => {
            if (e.target === modalConfirmar) {
                modalConfirmar.classList.remove('active');
                // Si hay una confirmación pendiente esperando respuesta, se resuelve como "cancelado"
                if (typeof resolverConfirmacionPendiente === 'function') {
                    resolverConfirmacionPendiente(false);
                }
            }
        });
    }
});

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
        const idUsuario = sessionStorage.getItem('id_usuario') || localStorage.getItem('id_usuario');
        await cargarCuentasOrigen(idUsuario);

    } catch (err) {
        console.error('💥 Error en transferencia:', err);
        alert('Ocurrió un error al procesar la transferencia.');
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

        function finalizar(resultado) {
            modal.classList.remove('active');
            btnConfirmar.removeEventListener('click', onConfirmar);
            btnCancelar.removeEventListener('click', onCancelar);
            resolverConfirmacionPendiente = null;
            resolve(resultado);
        }

        function onConfirmar() { finalizar(true); }
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