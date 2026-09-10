document.addEventListener('DOMContentLoaded', async () => {

    // El cierre de sesión, la conexión y la redirección si no hay sesión ya
    // las maneja sesion_comun.js (cargado antes que este archivo). Acá solo
    // se resuelve el id_usuario real (Supabase Auth, no sessionStorage) y se
    // usa para pintar el resumen de productos.
    let supabaseClient = null;
    if (typeof CONFIG !== 'undefined' && CONFIG.URL_DE_SUPABASE && CONFIG.KEY_ANON_SUPABASE && window.supabase) {
        supabaseClient = window.supabase.createClient(CONFIG.URL_DE_SUPABASE, CONFIG.KEY_ANON_SUPABASE);
    }

    if (!supabaseClient) return;

    const idUsuario = await resolverSesionCliente(supabaseClient);
    if (!idUsuario) return; // resolverSesionCliente ya redirigió a login

    await cargarResumenProductosPorUsuario(supabaseClient, idUsuario);
});

async function cargarResumenProductosPorUsuario(supabase, idUsuario) {
    const contenedorCuentas = document.getElementById('contenedorCuentas');
    const contenedorTarjetas = document.getElementById('contenedorTarjetas');
    const saludoUsuario = document.getElementById('saludoUsuario');

    if (!supabase) return;

    try {
        // BACKEND SENIOR TIP: Usamos relaciones anidadas basadas en tus llaves foráneas exactas.
        // Traemos el perfil del cliente, sus cuentas vinculadas por DPI y las tarjetas vinculadas a cada cuenta.
        const { data: cliente, error: errPerfil } = await supabase
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
                    tarjetas (
                        pan_enmascarado,
                        estado_tarjeta
                    )
                )
            `)
            .eq('id_usuario', idUsuario)
            .maybeSingle();

        if (errPerfil) {
            console.error("Error de base de datos en perfiles_clientes:", errPerfil);
            throw errPerfil;
        }

        if (!cliente) {
            contenedorCuentas.innerHTML = "<p style='color: var(--color-danger);'>No se encontró un perfil bancario asociado a este usuario.</p>";
            contenedorTarjetas.innerHTML = "<p style='color: var(--color-text-muted);'>No hay información de tarjetas.</p>";
            return;
        }

        // Colocar el nombre del cliente recuperado de la BD
        if (saludoUsuario) {
            saludoUsuario.textContent = `Bienvenido(a), ${cliente.nombres} ${cliente.apellidos}`;
        }

        const cuentas = cliente.cuentas || [];

        if (cuentas.length === 0) {
            contenedorCuentas.innerHTML = "<p style='color: var(--color-text-muted);'>No posees cuentas bancarias registradas.</p>";
            contenedorTarjetas.innerHTML = "<p style='color: var(--color-text-muted);'>No hay tarjetas para mostrar.</p>";
            return;
        }

        // ==========================================
        // RENDERIZAR CUENTAS
        // ==========================================
        contenedorCuentas.innerHTML = cuentas.map(cuenta => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--color-border);">
                <div>
                    <strong style="display: block; color: var(--color-text-main); font-size: 1rem;">Cuenta ${cuenta.tipo_cuenta}</strong>
                    <small style="color: var(--color-text-muted);">No. ${cuenta.numero_cuenta}</small>
                </div>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span class="money-live" style="font-size: 1.2rem; font-weight: 700; color: var(--color-text-main); font-variant-numeric: tabular-nums;">
                        ${cuenta.moneda === 'USD' ? '$' : 'Q'} ${parseFloat(cuenta.saldo_disponible).toLocaleString('es-GT', { minimumFractionDigits: 2 })}
                    </span>
                    <button class="btn-secondary-sm">Ver detalles</button>
                    <button class="btn-primary-sm">Transferir</button>
                </div>
            </div>
        `).join('');

        // ==========================================
        // EXTRAER Y RENDERIZAR TARJETAS
        // ==========================================
        // Aplanamos el array extrayendo todas las tarjetas incrustadas en cada una de las cuentas
        const tarjetas = cuentas.flatMap(cuenta => cuenta.tarjetas || []);

        if (tarjetas.length === 0) {
            contenedorTarjetas.innerHTML = "<p style='color: var(--color-text-muted);'>No tienes tarjetas asociadas a tus cuentas.</p>";
        } else {
            contenedorTarjetas.innerHTML = tarjetas.map(tarjeta => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--color-border);">
                    <div>
                        <strong style="display: block; color: var(--color-text-main);">Tarjeta Débito / Crédito</strong>
                        <small style="color: var(--color-text-muted);">${tarjeta.pan_enmascarado}</small>
                    </div>
                    <div>
                        <span style="background-color: var(--color-success-tint); color: var(--color-success); padding: 4px 10px; border-radius: 6px; font-size: 0.8rem; font-weight: 600;">
                            ${tarjeta.estado_tarjeta}
                        </span>
                    </div>
                </div>
            `).join('');
        }

    } catch (err) {
        console.error("💥 Error crítico en el pipeline del resumen de productos:", err);
        contenedorCuentas.innerHTML = "<p style='color: var(--color-danger);'>Error al recuperar la información del usuario.</p>";
    }
}