// EVENTOS Y LÓGICA DEL MODAL COMPROBANTE
document.addEventListener('DOMContentLoaded', () => {
    const btnDescargar = document.getElementById('btnDescargarPDF');
    const btnCerrar = document.getElementById('btnCerrarComprobante');

    if (btnDescargar) {
        btnDescargar.addEventListener('click', descargarComprobantePDF);
    }
    if (btnCerrar) {
        btnCerrar.addEventListener('click', cerrarModalComprobante);
    }
});

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

        const confirmado = confirm(
            `¿Confirmas la transferencia de ${simbolo} ${montoFormateado} a ${titular.nombre_completo}?`
        );

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

        // Generar número de referencia correlativo
        const numReferencia = 'REF-' + Math.floor(100000 + Math.random() * 900000);
        const fechaHora = new Date().toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'medium' });

        // Desplegar Pop-Out con la información requerida
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