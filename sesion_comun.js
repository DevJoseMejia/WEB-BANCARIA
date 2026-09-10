/**
 * Resuelve la sesión real del cliente contra Supabase Auth (ya no
 * sessionStorage, que cualquiera podía fabricar desde la consola). Si no hay
 * sesión válida, redirige a Login_personal.html y devuelve null -- quien
 * llama debe cortar su propia ejecución cuando reciba null.
 *
 * Devuelve el id_usuario "de negocio" (usuarios.id_usuario), que es la
 * misma llave que ya usa el resto del sitio (perfiles_clientes, cuentas,
 * transacciones, solicitudes_*) -- así ninguna otra consulta del proyecto
 * tuvo que cambiar, solo cómo se obtiene ese id.
 */
async function resolverSesionCliente(supabaseClient) {
    const { data } = await supabaseClient.auth.getSession();

    if (!data.session) {
        alert('Debes iniciar sesión para acceder a tu banca en línea.');
        window.location.href = 'Login_personal.html';
        return null;
    }

    const { data: usuarioRow, error } = await supabaseClient
        .from('usuarios')
        .select('id_usuario')
        .eq('auth_uid', data.session.user.id)
        .maybeSingle();

    if (error || !usuarioRow) {
        console.error('💥 No se pudo resolver el perfil del usuario:', error);
        alert('No se pudo cargar tu sesión. Intenta iniciar sesión de nuevo.');
        await supabaseClient.auth.signOut();
        window.location.href = 'Login_personal.html';
        return null;
    }

    return usuarioRow.id_usuario;
}

document.addEventListener('DOMContentLoaded', async () => {

    // 1. Conexión a Supabase
    let supabaseClient = null;
    if (typeof CONFIG !== 'undefined' && CONFIG.URL_DE_SUPABASE && CONFIG.KEY_ANON_SUPABASE && window.supabase) {
        supabaseClient = window.supabase.createClient(CONFIG.URL_DE_SUPABASE, CONFIG.KEY_ANON_SUPABASE);
    }

    // 2. Botón de Cerrar Sesión (igual en todas las páginas del dashboard)
    const btnCerrarSesion = document.getElementById('btnCerrarSesion');
    if (btnCerrarSesion) {
        btnCerrarSesion.addEventListener('click', async (e) => {
            e.preventDefault();
            if (supabaseClient) await supabaseClient.auth.signOut();
            alert("Sesión finalizada con éxito.");
            window.location.href = "Login_personal.html";
        });
    }

    if (!supabaseClient) {
        console.error("💥 No se pudo inicializar el cliente de Supabase. Revisa config.example.js.");
        return;
    }

    // 3. Verificar que haya una sesión activa (redirige sola si no la hay)
    const idUsuario = await resolverSesionCliente(supabaseClient);
    if (!idUsuario) return;

    // 4. Mostrar el nombre del usuario en el header, si esta página tiene #userName
    const elUserName = document.getElementById('userName');
    if (elUserName) {
        try {
            const { data: cliente, error } = await supabaseClient
                .from('perfiles_clientes')
                .select('nombres, apellidos')
                .eq('id_usuario', idUsuario)
                .maybeSingle();

            if (error) throw error;

            if (cliente) {
                elUserName.textContent = cliente.nombres;
            }
        } catch (err) {
            console.error("💥 Error al cargar el nombre del usuario:", err);
            // No mostramos alerta aquí: el saludo es cosmético, no bloqueamos
            // el uso de la página por esto.
        }
    }
});
