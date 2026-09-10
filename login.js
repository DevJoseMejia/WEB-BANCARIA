// 1. INICIALIZACIÓN CON VARIABLE DIFERENTE PARA EVITAR ERRORES DE ÁMBITO
const URL_DE_SUPABASE = CONFIG.URL_DE_SUPABASE;
const KEY_ANON_SUPABASE = CONFIG.KEY_ANON_SUPABASE;

// Cambiamos el nombre de la variable local a 'supabaseClient'
const supabaseClient = window.supabase.createClient(URL_DE_SUPABASE, KEY_ANON_SUPABASE);

// 2. SELECTORES DE ELEMENTOS
const formLogin = document.getElementById('form-login');
const txtEmail = document.getElementById('usuario');
const txtPassword = document.getElementById('contrasena');
const btnToggle = document.getElementById('btn-toggle-password');
const btnSubmitLogin = document.getElementById('btn-submit');

// ==========================================
// 3. FUNCIONALIDAD: Mostrar / Ocultar Contraseña
// ==========================================
if (btnToggle) {
    btnToggle.addEventListener('click', (e) => {
        e.preventDefault();
        const icon = btnToggle.querySelector('i');

        if (txtPassword.type === 'password') {
            txtPassword.type = 'text';
            if(icon) icon.className = 'ri-eye-line';
        } else {
            txtPassword.type = 'password';
            if(icon) icon.className = 'ri-eye-off-line';
        }
    });
}

// ==========================================
// 4. FUNCIONALIDAD: Envío del Login
// ==========================================
if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log("⏳ Iniciando handshake de autenticación...");

        const valorLogin = txtEmail.value.trim();
        const password = txtPassword.value;

        if (window.UVGMotion) window.UVGMotion.setButtonState(btnSubmitLogin, 'loading');

        try {
            // Supabase Auth autentica por correo. Esta RPC permite conservar
            // el acceso por username sin exponer datos sensibles.
            const { data: emailLogin, error: errorResolver } = await supabaseClient
                .rpc('resolver_email_login', { p_valor: valorLogin });

            if (errorResolver || !emailLogin) {
                console.error("💥 No se pudo resolver el usuario:", errorResolver);
                alert("Error de comunicación con el servidor.");
                if (window.UVGMotion) window.UVGMotion.setButtonState(btnSubmitLogin, null);
                return;
            }

            const { data: authData, error: errorAuth } = await supabaseClient.auth.signInWithPassword({
                email: emailLogin,
                password
            });

            if (errorAuth || !authData.session) {
                console.warn("⚠️ Credenciales inválidas.");
                alert("Usuario o contraseña incorrectos.");
                if (window.UVGMotion) window.UVGMotion.setButtonState(btnSubmitLogin, null);
                return;
            }

            const { data: usuario, error: errorUsuario } = await supabaseClient
                .from('usuarios')
                .select('id_usuario, estado_cuenta')
                .eq('auth_uid', authData.user.id)
                .maybeSingle();

            if (errorUsuario || !usuario) {
                await supabaseClient.auth.signOut();
                console.error("💥 La identidad no tiene un perfil bancario:", errorUsuario);
                alert("No se encontró un perfil bancario asociado a este acceso.");
                if (window.UVGMotion) window.UVGMotion.setButtonState(btnSubmitLogin, null);
                return;
            }

            if (usuario.estado_cuenta === 'Bloqueada') {
                await supabaseClient.auth.signOut();
                alert("Esta cuenta bancaria se encuentra bloqueada.");
                if (window.UVGMotion) window.UVGMotion.setButtonState(btnSubmitLogin, null);
                return;
            }

            // Registro de auditoría
            await supabaseClient.from('logs_accesos').insert([
                {
                    evento: 'Login Exitoso',
                    direccion_ip: '127.0.0.1',
                    geolocalizacion: 'Guatemala',
                    id_usuario: usuario.id_usuario
                }
            ]);

            // Mensaje de éxito y redirección
            if (window.UVGMotion) window.UVGMotion.setButtonState(btnSubmitLogin, 'done');
            window.location.href = "Banca_personal.html";

        } catch (err) {
            console.error("💥 Error crítico en el pipeline de login:", err);
            alert("Error de comunicación con el servidor.");
            if (window.UVGMotion) window.UVGMotion.setButtonState(btnSubmitLogin, null);
        }
    });
}
