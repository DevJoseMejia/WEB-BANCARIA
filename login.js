// 1. INICIALIZACIÓN CON VARIABLE DIFERENTE PARA EVITAR ERRORES DE ÁMBITO
const URL_DE_SUPABASE = "https://voymaybkdkoltsvbyozh.supabase.co";
const KEY_ANON_SUPABASE = "sb_publishable_pUqqpfXH7as_2KlMp_8YeA_r17vdSLX";

// Cambiamos el nombre de la variable local a 'supabaseClient'
const supabaseClient = window.supabase.createClient(URL_DE_SUPABASE, KEY_ANON_SUPABASE);

// 2. SELECTORES DE ELEMENTOS
const formLogin = document.getElementById('form-login');
const txtEmail = document.getElementById('usuario');
const txtPassword = document.getElementById('contrasena');
const btnToggle = document.getElementById('btn-toggle-password'); 

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
// 4. FUNCIONALIDAD: Envío del Login (Corregido id_rol)
// ==========================================
if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
        e.preventDefault(); 
        console.log("⏳ Iniciando handshake de autenticación...");
        
        const email = txtEmail.value.trim();
        const password = txtPassword.value;

        try {
            // 1. Petición limpia a la tabla usuarios (Corregido a 'id_rol')
            const { data: resultados, error } = await supabaseClient
                .from('usuarios')
                .select('id_usuario, password_hash, estado_cuenta, id_rol') 
                .eq('email', email);

            if (error) {
                console.error("💥 Error de base de datos:", error);
                alert("Error de comunicación con el servidor.");
                return;
            }

            // Si el arreglo viene vacío, significa que el correo no existe
            if (!resultados || resultados.length === 0) {
                console.warn("⚠️ El correo no existe en la tabla usuarios.");
                alert("Credenciales incorrectas o usuario no registrado.");
                return;
            }

            // Tomamos el primer resultado encontrado
            const usuario = resultados[0];
            console.log("✅ Usuario localizado con éxito:", usuario);

            if (usuario.estado_cuenta === 'Bloqueada') {
                alert("Esta cuenta bancaria se encuentra bloqueada.");
                return;
            }

            // 2. Ejecución de la función remota RPC para validar contraseña
            console.log("⏳ Solicitando verificación criptográfica al servidor...");
            const { data: passwordValido, error: errValidacion } = await supabaseClient
                .rpc('verificar_password', { 
                    pass_ingresado: password, 
                    hash_guardado: usuario.password_hash 
                });

            console.log("📊 Resultado RPC verificar_password:", passwordValido, "Error RPC:", errValidacion);

            if (errValidacion || !passwordValido) {
                alert("Contraseña incorrecta.");
                return;
            }

            // 3. Registro de auditoría
            await supabaseClient.from('logs_accesos').insert([
                {
                    evento: 'Login Exitoso',
                    direccion_ip: '127.0.0.1',
                    geolocalizacion: 'Guatemala',
                    id_usuario: usuario.id_usuario
                }
            ]);

            // Mensaje de éxito final
            alert("¡Bienvenido al sistema! Inicio de sesión exitoso.");
            window.location.href = "Banca_personal.html";

        } catch (err) {
            console.error("💥 Error crítico en el pipeline de login:", err);
            alert("Error de comunicación con el servidor.");
        }
    });
}