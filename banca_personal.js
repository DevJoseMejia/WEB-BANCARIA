document.addEventListener('DOMContentLoaded', async () => {

    // 1. Manejo del Cierre de Sesión
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
    let supabaseClient = null;
    if (typeof CONFIG !== 'undefined' && CONFIG.URL_DE_SUPABASE && CONFIG.KEY_ANON_SUPABASE) {
        if (window.supabase) {
            supabaseClient = window.supabase.createClient(CONFIG.URL_DE_SUPABASE, CONFIG.KEY_ANON_SUPABASE);
        }
    }

    // 3. Obtener el ID del usuario directamente de la sesión actual
    const idUsuario = sessionStorage.getItem('id_usuario') || localStorage.getItem('id_usuario');

    if (!idUsuario) {
        // Si intentan entrar a la página sin haber iniciado sesión, los redirige al Login
        alert("Debes iniciar sesión para acceder a tu banca en línea.");
        window.location.href = "Login_personal.html";
        return;
    }

    // Cargar productos usando el id_usuario de la sesión
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
            contenedorCuentas.innerHTML = "<p style='color: #ef4444;'>No se encontró un perfil bancario asociado a este usuario.</p>";
            contenedorTarjetas.innerHTML = "<p style='color: #64748b;'>No hay información de tarjetas.</p>";
            return;
        }

        // Colocar el nombre del cliente recuperado de la BD
        if (saludoUsuario) {
            saludoUsuario.textContent = `Bienvenido(a), ${cliente.nombres} ${cliente.apellidos}`;
        }

        const cuentas = cliente.cuentas || [];

        if (cuentas.length === 0) {
            contenedorCuentas.innerHTML = "<p style='color: #64748b;'>No posees cuentas bancarias registradas.</p>";
            contenedorTarjetas.innerHTML = "<p style='color: #64748b;'>No hay tarjetas para mostrar.</p>";
            return;
        }

        // ==========================================
        // RENDERIZAR CUENTAS
        // ==========================================
        contenedorCuentas.innerHTML = cuentas.map(cuenta => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #f1f5f9;">
                <div>
                    <strong style="display: block; color: #1e293b; font-size: 1rem;">Cuenta ${cuenta.tipo_cuenta}</strong>
                    <small style="color: #64748b;">No. ${cuenta.numero_cuenta}</small>
                </div>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="font-size: 1.2rem; font-weight: 700; color: #0f172a;">
                        ${cuenta.moneda === 'USD' ? '$' : 'Q'} ${parseFloat(cuenta.saldo_disponible).toLocaleString('es-GT', { minimumFractionDigits: 2 })}
                    </span>
                    <button class="btn-secondary" style="padding: 6px 12px; font-size: 0.85rem;">Ver detalles</button>
                    <button class="btn-primary" style="padding: 6px 12px; font-size: 0.85rem;">Transferir</button>
                </div>
            </div>
        `).join('');

        // ==========================================
        // EXTRAER Y RENDERIZAR TARJETAS
        // ==========================================
        // Aplanamos el array extrayendo todas las tarjetas incrustadas en cada una de las cuentas
        const tarjetas = cuentas.flatMap(cuenta => cuenta.tarjetas || []);

        if (tarjetas.length === 0) {
            contenedorTarjetas.innerHTML = "<p style='color: #64748b;'>No tienes tarjetas asociadas a tus cuentas.</p>";
        } else {
            contenedorTarjetas.innerHTML = tarjetas.map(tarjeta => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #f1f5f9;">
                    <div>
                        <strong style="display: block; color: #1e293b;">Tarjeta Débito / Crédito</strong>
                        <small style="color: #64748b;">${tarjeta.pan_enmascarado}</small>
                    </div>
                    <div>
                        <span style="background-color: #dcfce7; color: #15803d; padding: 4px 10px; border-radius: 6px; font-size: 0.8rem; font-weight: 600;">
                            ${tarjeta.estado_tarjeta}
                        </span>
                    </div>
                </div>
            `).join('');
        }

    } catch (err) {
        console.error("💥 Error crítico en el pipeline del resumen de productos:", err);
        contenedorCuentas.innerHTML = "<p style='color: #ef4444;'>Error al recuperar la información del usuario.</p>";
    }
}