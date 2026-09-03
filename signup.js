// Declaramos la variable del cliente backend globalmente para usarla en todo el documento
let supabaseClient;

document.addEventListener('DOMContentLoaded', () => {
    console.log("🚀 Módulo signup.js inicializado correctamente.");
    
    // Inicialización segura del cliente Supabase usando el objeto global del CDN
    try {
        if (typeof supabase === 'undefined') {
            console.error("❌ Error: La librería de Supabase no cargó correctamente desde el CDN.");
            alert("Error de infraestructura: No se pudo conectar al servidor de bases de datos.");
            return;
        }

        // config.example.js define el objeto CONFIG,
        // no variables sueltas SUPABASE_URL / SUPABASE_ANON_KEY. Antes esto lanzaba un
        // ReferenceError silencioso que abortaba toda la inicialización.
        if (typeof CONFIG === 'undefined' || !CONFIG.URL_DE_SUPABASE || !CONFIG.KEY_ANON_SUPABASE) {
            console.error("❌ Error: CONFIG no está definido o le faltan credenciales. Verifica que config.js se cargue antes de signup.js.");
            alert("Error de infraestructura: Configuración de Supabase no encontrada.");
            return;
        }

        supabaseClient = supabase.createClient(CONFIG.URL_DE_SUPABASE, CONFIG.KEY_ANON_SUPABASE);
        console.log("✅ Conexión con Supabase establecida en frontend.");
    } catch (initError) {
        console.error("❌ Error al inicializar el cliente de Supabase:", initError);
        return;
    }

    // Encender componentes funcionales
    initPasswordToggles();
    initSignupForm();
});

/**
 * FUNCIONALIDAD: Mostrar / Ocultar Contraseñas (Botones de visualización)
 */
function initPasswordToggles() {
    const bindToggle = (btnId, inputId) => {
        const btn = document.getElementById(btnId);
        const input = document.getElementById(inputId);

        if (btn && input) {
            btn.addEventListener('click', (e) => {
                // Detener el envío o recarga no deseada
                e.preventDefault();
                e.stopPropagation();

                // Intercambiar tipo de campo
                const isPassword = input.type === 'password';
                input.type = isPassword ? 'text' : 'password';

                // Modificar el icono visual usando clases nativas explícitas de Remix Icon
                const icon = btn.querySelector('i');
                if (icon) {
                    if (isPassword) {
                        icon.className = 'ri-eye-line'; // Cambia a ojo abierto
                    } else {
                        icon.className = 'ri-eye-off-line'; // Cambia a ojo cerrado/tachado
                    }
                }
            });
        }
    };

    // Acoplar a los dos botones de tu HTML
    bindToggle('btn-toggle-contrasena', 'contrasena');
    bindToggle('btn-toggle-confirmar', 'confirmar_contrasena');
}

/**
 * FUNCIONALIDAD: Captura de formulario y Submit hacia Supabase
 */
function initSignupForm() {
    const form = document.getElementById('form-signup');
    const btnSubmit = document.getElementById('btn-submit');

    if (!form) return;

    form.addEventListener('submit', async (e) => {
        // 🚨 CRUCIAL: Esto detiene inmediatamente que la página se recargue y borre los datos
        e.preventDefault(); 

        console.log("⏳ Procesando envío de formulario de forma controlada...");

        // Deshabilitar botón para evitar multi-envíos
        btnSubmit.disabled = true;
        const originalBtnContent = btnSubmit.innerHTML;
        btnSubmit.innerText = "Procesando solicitud...";

        // Captura de inputs
        const usuarioValue = document.getElementById('usuario').value.trim();
        const emailValue = document.getElementById('correo').value.trim();
        const celularValue = document.getElementById('celular').value.trim();
        const passwordValue = document.getElementById('contrasena').value;
        const confirmPasswordValue = document.getElementById('confirmar_contrasena').value;

        if (passwordValue !== confirmPasswordValue) {
            alert("❌ Las contraseñas no coinciden.");
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = originalBtnContent;
            return;
        }

        try {
            // Buscamos el id_rol real consultando la tabla 'roles' por nombre,
            // en vez de depender de un UUID copiado a mano 
            const { data: rolCliente, error: errRol } = await supabaseClient
                .from('roles')
                .select('id_rol')
                .eq('nombre_rol', 'Cliente')
                .maybeSingle();

            if (errRol || !rolCliente) {
                console.error("❌ No se encontró el rol 'Cliente' en la tabla roles:", errRol);
                throw new Error("No se pudo determinar el rol de cliente. Verifica la tabla roles.");
            }

            // Hasheamos la contraseña en el servidor (Postgres/pgcrypto) vía RPC,
            // en vez de guardarla en texto plano o hashearla con JS en el cliente.
            // Esto requiere haber creado la función 'hash_password' en Supabase
            // (ver hash_password_rpc.sql).
            const { data: passwordHasheada, error: errHash } = await supabaseClient
                .rpc('hash_password', { password: passwordValue });

            if (errHash || !passwordHasheada) {
                console.error("❌ Error al hashear la contraseña:", errHash);
                throw new Error("No se pudo procesar la contraseña de forma segura.");
            }

            // Inserción directa en la tabla 'usuarios'
            const { data, error } = await supabaseClient
                .from('usuarios')
                .insert([
                    {
                        username: usuarioValue,
                        email: emailValue,
                        celular: celularValue,
                        password_hash: passwordHasheada,
                        estado_cuenta: 'Activa',
                        intentos_fallidos: 0,
                        requiere_mfa: false,
                        id_rol: rolCliente.id_rol
                    }
                ])
                .select();

            if (error) throw error;

            alert("🎉 ¡Solicitud enviada! Usuario registrado con éxito. Ahora puedes iniciar sesión.");
            form.reset(); // Ahora sí, limpia el formulario SOLO si la inserción fue exitosa

            // Enviamos al usuario al login en vez de "auto-loguearlo": no hay sesión
            // creada aquí (eso solo pasa en login.js tras validar la contraseña con
            // verificar_password), y conceptualmente el registro es una solicitud,
            // no un acceso inmediato a la banca.
            window.location.href = "Login_personal.html";

        } catch (err) {
            console.error("❌ Error al insertar en la base de datos:", err);
            alert(`Error de Base de Datos: ${err.message || err}`);
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = originalBtnContent;
        }
    });
}