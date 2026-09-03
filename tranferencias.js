// CONTROLADOR DE LÓGICA: TRANSFERENCIAS ENTRE CUENTAS (MISMO BANCO)

// Guardamos en memoria el perfil del usuario logueado (con sus cuentas)
// para reusarlo en los siguientes pasos: validación, confirmación y PDF.
let clienteSesion = null;
let supabaseClient = null;

document.addEventListener('DOMContentLoaded', async () => {

    // 1. Cierre de sesión
    const btnCerrarSesion = document.getElementById('btnCerrarSesion');
    if (btnCerrarSesion) {
        btnCerrarSesion.addEventListener('click', (e) => {
            e.preventDefault();
            sessionStorage.clear();
            localStorage.clear();
            alert("Sesión finalizada con éxito.");
            window.location.href = "Login_personal.html";
        });
    }

    // 2. Conexión a Supabase
    if (typeof CONFIG !== 'undefined' && CONFIG.URL_DE_SUPABASE && CONFIG.KEY_ANON_SUPABASE && window.supabase) {
        supabaseClient = window.supabase.createClient(CONFIG.URL_DE_SUPABASE, CONFIG.KEY_ANON_SUPABASE);
    }

    // 3. Verificar sesión activa
    const idUsuario = sessionStorage.getItem('id_usuario') || localStorage.getItem('id_usuario');
    if (!idUsuario) {
        alert("Debes iniciar sesión para acceder a tu banca en línea.");
        window.location.href = "Login_personal.html";
        return;
    }

    if (!supabaseClient) {
        console.error("💥 No se pudo inicializar el cliente de Supabase. Revisa config.example.js.");
        return;
    }

    // 4. Cargar las cuentas reales del usuario en el select de origen
    await cargarCuentasOrigen(idUsuario);

    // 5. Reaccionar a cambios de cuenta origen / monto para mostrar saldo y validar
    const selectOrigen = document.getElementById('mb-cuenta-origen');
    const inputMonto = document.getElementById('mb-monto');

    if (selectOrigen) {
        selectOrigen.addEventListener('change', actualizarSaldoDisponible);
    }
    if (inputMonto) {
        inputMonto.addEventListener('input', validarMontoContraSaldo);
    }

    // 6. Envío del formulario de transferencia mismo banco
    const formMismoBanco = document.getElementById('form-mismo-banco');
    if (formMismoBanco) {
        formMismoBanco.addEventListener('submit', manejarSubmitTransferencia);
    }
});

/**
 * Maneja el envío del formulario de transferencia mismo banco:
 * valida, busca al titular de la cuenta destino, pide confirmación,
 * ejecuta la transferencia vía RPC y genera el PDF del comprobante.
 */
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

    // Validaciones básicas del lado del cliente (la validación real y
    // definitiva ocurre de nuevo dentro del RPC en la base de datos)
    if (!cuentaOrigen) {
        alert('Selecciona una cuenta de origen.');
        return;
    }
    if (!cuentaDestino) {
        alert('Ingresa el número de cuenta destino.');
        return;
    }
    if (cuentaDestino === cuentaOrigen) {
        alert('La cuenta destino no puede ser la misma que la cuenta origen.');
        return;
    }
    if (isNaN(monto) || monto <= 0) {
        alert('Ingresa un monto válido mayor a 0.');
        return;
    }
    if (!isNaN(saldoOrigen) && monto > saldoOrigen) {
        alert('El monto supera el saldo disponible de la cuenta origen.');
        return;
    }

    btnSubmit.disabled = true;
    const textoOriginalBtn = btnSubmit.innerHTML;
    btnSubmit.innerHTML = 'Verificando cuenta destino...';

    try {
        // Buscamos el titular de la cuenta destino (nombre, moneda, estado)
        // sin exponer su saldo ni otros datos del perfil.
        const { data: titularData, error: errTitular } = await supabaseClient
            .rpc('obtener_titular_cuenta', { p_numero_cuenta: cuentaDestino });

        if (errTitular) {
            console.error('💥 Error al buscar la cuenta destino:', errTitular);
            alert('Ocurrió un error al validar la cuenta destino.');
            return;
        }

        const titular = Array.isArray(titularData) ? titularData[0] : titularData;

        if (!titular) {
            alert('La cuenta destino no existe. Verifica el número de cuenta.');
            return;
        }

        if (titular.estado !== 'Activa') {
            alert('La cuenta destino no está activa y no puede recibir transferencias.');
            return;
        }

        if (monedaOrigen && titular.moneda && monedaOrigen !== titular.moneda) {
            alert(`No es posible transferir: la cuenta origen es en ${monedaOrigen} y la cuenta destino es en ${titular.moneda}.`);
            return;
        }

        const simbolo = monedaOrigen === 'USD' ? '$' : 'Q';
        const montoFormateado = monto.toLocaleString('es-GT', { minimumFractionDigits: 2 });

        // Confirmación con el nombre real del destinatario
        const confirmado = confirm(
            `¿Confirmas la transferencia de ${simbolo} ${montoFormateado} a ${titular.nombre_completo} (cuenta ${cuentaDestino})?`
        );

        if (!confirmado) {
            return;
        }

        btnSubmit.innerHTML = 'Procesando transferencia...';

        // Ejecutamos la transferencia de forma atómica en la base de datos
        const { data: resultado, error: errTransferencia } = await supabaseClient
            .rpc('realizar_transferencia_mismo_banco', {
                p_cuenta_origen: cuentaOrigen,
                p_cuenta_destino: cuentaDestino,
                p_monto: monto,
                p_motivo: motivo
            });

        if (errTransferencia) {
            console.error('💥 Error al ejecutar la transferencia:', errTransferencia);
            alert(`No se pudo realizar la transferencia: ${errTransferencia.message}`);
            return;
        }

        // Nombre del remitente: viene del perfil cargado en el paso 1
        const nombreRemitente = clienteSesion
            ? `${clienteSesion.nombres} ${clienteSesion.apellidos}`
            : 'Titular de la cuenta';

        generarComprobantePDF({
            nombreRemitente,
            cuentaOrigen,
            tipoOrigen,
            cuentaDestino,
            nombreDestinatario: titular.nombre_completo,
            monto,
            simbolo,
            motivo
        });

        alert('✅ Transferencia realizada con éxito. Se descargó tu comprobante en PDF.');

        // Limpiamos el formulario y recargamos los saldos actualizados
        document.getElementById('form-mismo-banco').reset();
        const idUsuario = sessionStorage.getItem('id_usuario') || localStorage.getItem('id_usuario');
        await cargarCuentasOrigen(idUsuario);

    } catch (err) {
        console.error('💥 Error crítico en el pipeline de transferencia:', err);
        alert('Ocurrió un error inesperado al procesar la transferencia.');
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = textoOriginalBtn;
    }
}

/**
 * Genera y descarga automáticamente el comprobante de la transferencia
 * en PDF usando jsPDF (cargado desde CDN en el HTML).
 */
function generarComprobantePDF(datos) {
    if (!window.jspdf) {
        console.error('💥 jsPDF no está disponible. Verifica que el script de la CDN esté cargado.');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const fecha = new Date().toLocaleString('es-GT', {
        dateStyle: 'long',
        timeStyle: 'short'
    });

    doc.setFontSize(16);
    doc.text('Banco UVG - Comprobante de Transferencia', 15, 20);

    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Fecha: ${fecha}`, 15, 28);

    doc.setDrawColor(200);
    doc.line(15, 32, 195, 32);

    doc.setFontSize(12);
    doc.setTextColor(0);

    const filas = [
        ['Ordenante (quien envía):', datos.nombreRemitente],
        ['Cuenta debitada:', `${datos.tipoOrigen || ''} No. ${datos.cuentaOrigen}`],
        ['Cuenta acreditada:', datos.cuentaDestino],
        ['Beneficiario (quien recibe):', datos.nombreDestinatario],
        ['Monto transferido:', `${datos.simbolo} ${datos.monto.toLocaleString('es-GT', { minimumFractionDigits: 2 })}`],
        ['Motivo:', datos.motivo]
    ];

    let y = 45;
    filas.forEach(([etiqueta, valor]) => {
        doc.setFont(undefined, 'bold');
        doc.text(etiqueta, 15, y);
        doc.setFont(undefined, 'normal');
        doc.text(String(valor), 90, y);
        y += 10;
    });

    doc.setFontSize(9);
    doc.setTextColor(150);
    doc.text('Este comprobante es una constancia generada automáticamente por Banco UVG.', 15, y + 10);

    const nombreArchivo = `comprobante_transferencia_${Date.now()}.pdf`;
    doc.save(nombreArchivo);
}

/**
 * Trae el perfil del usuario logueado junto con sus cuentas activas
 * y llena el <select> de cuenta origen con datos reales (no estáticos).
 */
async function cargarCuentasOrigen(idUsuario) {
    const selectOrigen = document.getElementById('mb-cuenta-origen');
    if (!selectOrigen) return;

    try {
        const { data: cliente, error } = await supabaseClient
            .from('perfiles_clientes')
            .select(`
                dpi,
                nombres,
                apellidos,
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

        if (!cliente) {
            selectOrigen.innerHTML = '<option value="" disabled selected>No se encontró un perfil bancario</option>';
            return;
        }

        clienteSesion = cliente;

        // Solo mostramos cuentas activas como posibles orígenes de una transferencia
        const cuentas = (cliente.cuentas || []).filter(c => c.estado === 'Activa');

        if (cuentas.length === 0) {
            selectOrigen.innerHTML = '<option value="" disabled selected>No tienes cuentas activas</option>';
            return;
        }

        const opciones = cuentas.map(cuenta => {
            const simbolo = cuenta.moneda === 'USD' ? '$' : 'Q';
            const saldoFormateado = parseFloat(cuenta.saldo_disponible).toLocaleString('es-GT', { minimumFractionDigits: 2 });
            return `<option value="${cuenta.numero_cuenta}" data-saldo="${cuenta.saldo_disponible}" data-moneda="${cuenta.moneda}" data-tipo="${cuenta.tipo_cuenta}">
                Cuenta ${cuenta.tipo_cuenta} (No. ${cuenta.numero_cuenta}) - ${simbolo} ${saldoFormateado}
            </option>`;
        }).join('');

        selectOrigen.innerHTML = '<option value="" disabled selected>Selecciona cuenta de origen</option>' + opciones;

    } catch (err) {
        console.error("💥 Error al cargar cuentas de origen:", err);
        selectOrigen.innerHTML = '<option value="" disabled selected>Error al cargar tus cuentas</option>';
    }
}

/**
 * Muestra el saldo disponible de la cuenta seleccionada bajo el select,
 * y limpia cualquier validación previa del monto (porque cambió la cuenta).
 */
function actualizarSaldoDisponible() {
    const selectOrigen = document.getElementById('mb-cuenta-origen');
    const hintSaldo = document.getElementById('mb-saldo-disponible');
    const inputMonto = document.getElementById('mb-monto');
    if (!selectOrigen || !hintSaldo) return;

    const opcionSeleccionada = selectOrigen.options[selectOrigen.selectedIndex];
    const saldo = opcionSeleccionada ? parseFloat(opcionSeleccionada.dataset.saldo) : NaN;
    const moneda = opcionSeleccionada ? opcionSeleccionada.dataset.moneda : null;

    if (!isNaN(saldo)) {
        const simbolo = moneda === 'USD' ? '$' : 'Q';
        hintSaldo.textContent = `Saldo disponible: ${simbolo} ${saldo.toLocaleString('es-GT', { minimumFractionDigits: 2 })}`;
        hintSaldo.style.color = '#64748b';
    } else {
        hintSaldo.textContent = '';
    }

    // Si ya había un monto escrito, lo revalidamos contra la nueva cuenta
    if (inputMonto && inputMonto.value) {
        validarMontoContraSaldo();
    }
}

/**
 * Valida en vivo que el monto ingresado no supere el saldo disponible
 * de la cuenta origen seleccionada. Usa setCustomValidity para que el
 * propio <form required> bloquee el envío si el monto es inválido.
 */
function validarMontoContraSaldo() {
    const selectOrigen = document.getElementById('mb-cuenta-origen');
    const inputMonto = document.getElementById('mb-monto');
    const hintSaldo = document.getElementById('mb-saldo-disponible');
    if (!selectOrigen || !inputMonto) return;

    const opcionSeleccionada = selectOrigen.options[selectOrigen.selectedIndex];
    const saldo = opcionSeleccionada ? parseFloat(opcionSeleccionada.dataset.saldo) : NaN;
    const monto = parseFloat(inputMonto.value);

    if (isNaN(saldo)) {
        // Todavía no ha seleccionado cuenta de origen
        inputMonto.setCustomValidity('');
        return;
    }

    if (!isNaN(monto) && monto > saldo) {
        inputMonto.setCustomValidity('El monto no puede ser mayor al saldo disponible en la cuenta origen.');
        if (hintSaldo) hintSaldo.style.color = '#ef4444';
    } else if (!isNaN(monto) && monto <= 0) {
        inputMonto.setCustomValidity('El monto debe ser mayor a cero.');
    } else {
        inputMonto.setCustomValidity('');
        if (hintSaldo) hintSaldo.style.color = '#64748b';
    }
}