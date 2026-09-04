

document.addEventListener('DOMContentLoaded', async () => {

    // 1. Conexión a Supabase
    let supabaseClient = null;
    if (typeof CONFIG !== 'undefined' && CONFIG.URL_DE_SUPABASE && CONFIG.KEY_ANON_SUPABASE && window.supabase) {
        supabaseClient = window.supabase.createClient(CONFIG.URL_DE_SUPABASE, CONFIG.KEY_ANON_SUPABASE);
    } else {
        console.error('No se pudo inicializar Supabase. Revisa que config.example.js se cargue antes de consultas.js.');
    }

    // 2. Cierre de sesión
    const btnCerrarSesion = document.getElementById('btnCerrarSesion');
    if (btnCerrarSesion) {
        btnCerrarSesion.addEventListener('click', () => {
            sessionStorage.clear();
            localStorage.clear();
            window.location.href = 'Login_personal.html';
        });
    }

    // 3. Verificar sesión activa
    const idUsuario = sessionStorage.getItem('id_usuario') || localStorage.getItem('id_usuario');
    if (!idUsuario) {
        alert('Debes iniciar sesión para acceder a tu banca en línea.');
        window.location.href = 'Login_personal.html';
        return;
    }

    if (!supabaseClient) return;

    // Elementos del DOM
    const selectCuenta = document.getElementById('select-cuenta');
    const btnMesSelector = document.getElementById('btn-mes-selector');
    const mesActualLabel = document.getElementById('mes-actual-label');
    const menuMeses = document.getElementById('menu-meses');
    const listaMeses = document.getElementById('lista-meses');
    const contenedorMovimientos = document.getElementById('contenedorMovimientos');
    const totalIngresosEl = document.getElementById('totalIngresos');
    const totalEgresosEl = document.getElementById('totalEgresos');
    const tituloHistorial = document.getElementById('tituloHistorial');
    const btnExportarPDF = document.getElementById('btnExportarPDF');

    const NOMBRES_MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    let cuentasUsuario = [];
    let cuentaSeleccionada = null;
    let fechaSeleccionada = primerDiaDelMes(new Date());

    // ================= FUNCIONES =================

    async function cargarCuentasUsuario() {
        try {
            // Mismo patrón exacto que ya usa banca_personal.js:
            // perfiles_clientes -> cuentas, vinculado por id_usuario.
            const { data: cliente, error } = await supabaseClient
                .from('perfiles_clientes')
                .select(`
                    nombres,
                    apellidos,
                    cuentas (
                        numero_cuenta,
                        tipo_cuenta,
                        moneda
                    )
                `)
                .eq('id_usuario', idUsuario)
                .maybeSingle();

            if (error) throw error;

            const userNameEl = document.getElementById('userName');
            if (userNameEl && cliente) {
                userNameEl.textContent = `${cliente.nombres} ${cliente.apellidos}`;
            }

            cuentasUsuario = (cliente && cliente.cuentas) || [];

            if (cuentasUsuario.length === 0) {
                selectCuenta.innerHTML = '<option value="" disabled selected>No tienes cuentas registradas</option>';
                mostrarEstadoSinCuenta();
                return;
            }

            selectCuenta.innerHTML = '<option value="" disabled selected>Selecciona una cuenta</option>' +
                cuentasUsuario.map(c => `
                    <option value="${c.numero_cuenta}">${c.tipo_cuenta} (${c.moneda}) - **** ${String(c.numero_cuenta).slice(-4)}</option>
                `).join('');

        } catch (err) {
            console.error('Error al cargar las cuentas del usuario:', err);
            selectCuenta.innerHTML = '<option value="" disabled selected>Error al cargar tus cuentas</option>';
        }
    }

    function construirMenuMeses() {
        const hoy = new Date();
        let items = '';
        for (let i = 0; i < 12; i++) {
            const f = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
            const etiqueta = i === 0
                ? `${NOMBRES_MESES[f.getMonth()]} ${f.getFullYear()} (mes actual)`
                : `${NOMBRES_MESES[f.getMonth()]} ${f.getFullYear()}`;
            items += `<li data-anio="${f.getFullYear()}" data-mes="${f.getMonth()}">${etiqueta}</li>`;
        }
        listaMeses.innerHTML = items;

        listaMeses.querySelectorAll('li').forEach(li => {
            li.addEventListener('click', () => {
                fechaSeleccionada = new Date(parseInt(li.dataset.anio, 10), parseInt(li.dataset.mes, 10), 1);
                actualizarLabelMes();
                menuMeses.hidden = true;
                if (cuentaSeleccionada) cargarMovimientos();
            });
        });
    }

    function actualizarLabelMes() {
        mesActualLabel.textContent = `${NOMBRES_MESES[fechaSeleccionada.getMonth()]} ${fechaSeleccionada.getFullYear()}`;
    }

    function mostrarEstadoSinCuenta() {
        contenedorMovimientos.innerHTML = `
            <tr><td colspan="5" style="text-align:center; color:#64748b; padding: 24px;">
                Selecciona una cuenta para ver tus movimientos.
            </td></tr>`;
        totalIngresosEl.textContent = '--';
        totalEgresosEl.textContent = '--';
        btnMesSelector.disabled = true;
        if (tituloHistorial) tituloHistorial.textContent = 'Historial de Transacciones';
    }

    async function cargarMovimientos() {
        if (!cuentaSeleccionada) return;

        contenedorMovimientos.innerHTML = `
            <tr><td colspan="5" style="text-align:center; color:#64748b; padding: 24px;">
                Cargando movimientos...
            </td></tr>`;

        const inicio = fechaSeleccionada;
        const fin = new Date(fechaSeleccionada.getFullYear(), fechaSeleccionada.getMonth() + 1, 1);
        const numeroCuenta = cuentaSeleccionada.numero_cuenta;

        try {
            const { data, error } = await supabaseClient
                .from('transacciones')
                .select('*')
                .or(`cuenta_origen.eq.${numeroCuenta},cuenta_destino.eq.${numeroCuenta}`)
                .gte('fecha_hora', inicio.toISOString())
                .lt('fecha_hora', fin.toISOString())
                .order('fecha_hora', { ascending: false });

            if (error) throw error;

            renderizarMovimientos(data || []);

        } catch (err) {
            console.error('Error al cargar transacciones:', err);
            contenedorMovimientos.innerHTML = `
                <tr><td colspan="5" style="text-align:center; color:#ef4444; padding: 24px;">
                    Ocurrió un error al cargar tus movimientos.
                </td></tr>`;
        }
    }

    function renderizarMovimientos(transacciones) {
        const simbolo = cuentaSeleccionada.moneda === 'USD' ? '$' : 'Q';
        const cuentaLabel = `${cuentaSeleccionada.tipo_cuenta} (**** ${String(cuentaSeleccionada.numero_cuenta).slice(-4)})`;

        if (tituloHistorial) {
            tituloHistorial.textContent = `Historial de Transacciones — ${cuentaLabel}`;
        }

        if (transacciones.length === 0) {
            contenedorMovimientos.innerHTML = `
                <tr><td colspan="5" style="text-align:center; color:#64748b; padding: 24px;">
                    No hay movimientos registrados en este periodo.
                </td></tr>`;
            totalIngresosEl.textContent = `${simbolo} 0.00`;
            totalEgresosEl.textContent = `${simbolo} 0.00`;
            return;
        }

        let totalIngresos = 0;
        let totalEgresos = 0;

        contenedorMovimientos.innerHTML = transacciones.map(tx => {
            const esIngreso = tx.cuenta_destino === cuentaSeleccionada.numero_cuenta;
            const monto = parseFloat(tx.monto);

            if (esIngreso) totalIngresos += monto; else totalEgresos += monto;

            const fecha = new Date(tx.fecha_hora).toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const otraCuenta = esIngreso ? tx.cuenta_origen : tx.cuenta_destino;
            const descripcionPrincipal = tx.tipo_transaccion || 'Movimiento';
            const descripcionSecundaria = esIngreso
                ? `Recibido de cuenta **** ${String(otraCuenta || '----').slice(-4)}`
                : `Enviado a cuenta **** ${String(otraCuenta || '----').slice(-4)}`;

            return `
                <tr>
                    <td>${fecha}</td>
                    <td>
                        <div class="tx-info">
                            <strong>${descripcionPrincipal}</strong>
                            <small>${descripcionSecundaria}</small>
                        </div>
                    </td>
                    <td>${cuentaLabel}</td>
                    <td>${tx.codigo_autorizacion || '—'}</td>
                    <td class="amount ${esIngreso ? 'positive' : 'negative'}">${esIngreso ? '+' : '-'} ${simbolo} ${monto.toLocaleString('es-GT', { minimumFractionDigits: 2 })}</td>
                </tr>
            `;
        }).join('');

        totalIngresosEl.textContent = `${simbolo} ${totalIngresos.toLocaleString('es-GT', { minimumFractionDigits: 2 })}`;
        totalEgresosEl.textContent = `${simbolo} ${totalEgresos.toLocaleString('es-GT', { minimumFractionDigits: 2 })}`;
    }

    function exportarPDF() {
        if (!cuentaSeleccionada) {
            alert('Selecciona una cuenta antes de exportar.');
            return;
        }
        if (typeof html2pdf === 'undefined') {
            alert('No se pudo cargar el generador de PDF. Revisa tu conexión e inténtalo de nuevo.');
            return;
        }

        const elemento = document.getElementById('areaExportablePDF');
        const nombreMes = mesActualLabel.textContent.replace(/\s+/g, '_');
        const opciones = {
            margin: 0.5,
            filename: `movimientos_${cuentaSeleccionada.numero_cuenta}_${nombreMes}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
        };

        html2pdf().set(opciones).from(elemento).save();
    }

    function primerDiaDelMes(fecha) {
        return new Date(fecha.getFullYear(), fecha.getMonth(), 1);
    }

    // ================= EVENTOS =================

    selectCuenta.addEventListener('change', () => {
        cuentaSeleccionada = cuentasUsuario.find(c => c.numero_cuenta === selectCuenta.value) || null;
        fechaSeleccionada = primerDiaDelMes(new Date());
        actualizarLabelMes();

        if (cuentaSeleccionada) {
            btnMesSelector.disabled = false;
            cargarMovimientos();
        } else {
            mostrarEstadoSinCuenta();
        }
    });

    btnMesSelector.addEventListener('click', () => {
        menuMeses.hidden = !menuMeses.hidden;
    });

    document.addEventListener('click', (e) => {
        if (!menuMeses.hidden && !menuMeses.contains(e.target) && !btnMesSelector.contains(e.target)) {
            menuMeses.hidden = true;
        }
    });

    if (btnExportarPDF) {
        btnExportarPDF.addEventListener('click', exportarPDF);
    }

    // ================= INICIALIZACIÓN =================

    await cargarCuentasUsuario();
    construirMenuMeses();
    actualizarLabelMes();
    mostrarEstadoSinCuenta();

});