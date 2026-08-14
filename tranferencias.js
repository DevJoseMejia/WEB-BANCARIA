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
});

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