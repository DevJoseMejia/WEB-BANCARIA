// Login del Portal de Colaboradores (staff).
// Usa Supabase Auth real (no la tabla `usuarios` de clientes): el código de
// trabajador se traduce a un correo interno sintético antes de autenticar,
// para que el personal no tenga que manejar/recordar un email real.
const DOMINIO_STAFF = "staff.bancouvg.internal";

document.addEventListener('DOMContentLoaded', () => {
    if (typeof supabase === 'undefined' || typeof CONFIG_ADMIN === 'undefined') {
        alert("Error de infraestructura: no se pudo cargar la configuración de Supabase.");
        return;
    }

    const supabaseClient = supabase.createClient(CONFIG_ADMIN.URL_DE_SUPABASE, CONFIG_ADMIN.KEY_ANON_SUPABASE);

    // Si ya hay una sesión de staff activa, saltar directo al panel.
    supabaseClient.auth.getSession().then(({ data }) => {
        const rol = data.session?.user?.app_metadata?.role;
        if (data.session && ['Trabajador', 'Supervisor', 'Administrador'].includes(rol)) {
            window.location.href = 'panel.html';
        }
    });

    const form = document.getElementById('form-login-admin');
    const inputPassword = document.getElementById('contrasena');
    const btnToggle = document.getElementById('btn-toggle-password');
    const btnSubmit = document.getElementById('btn-submit');

    if (btnToggle) {
        btnToggle.addEventListener('click', (e) => {
            e.preventDefault();
            const icon = btnToggle.querySelector('i');
            const isPassword = inputPassword.type === 'password';
            inputPassword.type = isPassword ? 'text' : 'password';
            if (icon) icon.className = isPassword ? 'ri-eye-line' : 'ri-eye-off-line';
        });
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const codigo = document.getElementById('codigo').value.trim().toUpperCase();
        const password = inputPassword.value;

        if (!codigo) {
            alert("Ingresa tu código de trabajador.");
            return;
        }

        const emailInterno = `${codigo}@${DOMINIO_STAFF}`;

        if (window.UVGMotion) window.UVGMotion.setButtonState(btnSubmit, 'loading');

        try {
            const { data, error } = await supabaseClient.auth.signInWithPassword({
                email: emailInterno,
                password
            });

            if (error || !data.session) {
                console.error("Error de login de staff:", error);
                alert("Código o contraseña incorrectos.");
                if (window.UVGMotion) window.UVGMotion.setButtonState(btnSubmit, null);
                return;
            }

            const rol = data.user?.app_metadata?.role;
            if (!['Trabajador', 'Supervisor', 'Administrador'].includes(rol)) {
                await supabaseClient.auth.signOut();
                alert("Este acceso no pertenece a un colaborador autorizado.");
                if (window.UVGMotion) window.UVGMotion.setButtonState(btnSubmit, null);
                return;
            }

            if (window.UVGMotion) window.UVGMotion.setButtonState(btnSubmit, 'done');
            window.location.href = 'panel.html';
        } catch (err) {
            console.error("Error crítico en login de staff:", err);
            alert("Error de comunicación con el servidor.");
            if (window.UVGMotion) window.UVGMotion.setButtonState(btnSubmit, null);
        }
    });
});
