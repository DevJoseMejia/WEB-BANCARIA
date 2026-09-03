
document.addEventListener('DOMContentLoaded', async () => {

    // 1. Botón de Cerrar Sesión (igual en todas las páginas del dashboard)
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
    if (typeof CONFIG !== 'undefined' && CONFIG.URL_DE_SUPABASE && CONFIG.KEY_ANON_SUPABASE && window.supabase) {
        supabaseClient = window.supabase.createClient(CONFIG.URL_DE_SUPABASE, CONFIG.KEY_ANON_SUPABASE);
    }

    // 3. Verificar que haya una sesión activa
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