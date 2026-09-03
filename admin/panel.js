let supabaseClient;
let sesionActual = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof supabase === 'undefined' || typeof CONFIG_ADMIN === 'undefined') {
        alert("Error de infraestructura: no se pudo cargar la configuración de Supabase.");
        return;
    }

    supabaseClient = supabase.createClient(CONFIG_ADMIN.URL_DE_SUPABASE, CONFIG_ADMIN.KEY_ANON_SUPABASE);

    const { data } = await supabaseClient.auth.getSession();
    if (!data.session) {
        window.location.href = 'login.html';
        return;
    }
    sesionActual = data.session;

    pintarUsuarioEnHeader();

    const btnCerrarSesion = document.getElementById('btnCerrarSesion');
    btnCerrarSesion.addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        window.location.href = 'login.html';
    });

    document.getElementById('form-crear-cliente').addEventListener('submit', manejarCrearCliente);
    document.getElementById('form-crear-staff').addEventListener('submit', manejarCrearStaff);
    document.getElementById('form-buscar-staff').addEventListener('submit', manejarBuscarStaff);
    document.getElementById('btnVerUltimosStaff').addEventListener('click', () => {
        document.getElementById('buscar-codigo').value = '';
        cargarUltimosCajeros();
    });

    inicializarFormularioCliente();
});

/**
 * Filtros de entrada (DPI y teléfono solo dígitos) + generación en vivo
 * del username a partir de nombres/apellidos/DPI, con verificación de
 * disponibilidad contra la tabla `usuarios`.
 */
function inicializarFormularioCliente() {
    const inputDpi = document.getElementById('cli-dpi');
    const inputTelefono = document.getElementById('cli-telefono');

    inputDpi.addEventListener('input', () => {
        inputDpi.value = inputDpi.value.replace(/\D/g, '').slice(0, 13);
        dispararGeneracionUsuario();
    });

    inputTelefono.addEventListener('input', () => {
        inputTelefono.value = inputTelefono.value.replace(/\D/g, '').slice(0, 8);
    });

    ['cli-nombres', 'cli-apellido1', 'cli-apellido2'].forEach(id => {
        document.getElementById(id).addEventListener('input', dispararGeneracionUsuario);
    });
}

let temporizadorUsuario = null;
function dispararGeneracionUsuario() {
    const inputUsuario = document.getElementById('cli-usuario');
    clearTimeout(temporizadorUsuario);

    const nombres = document.getElementById('cli-nombres').value;
    const apellido1 = document.getElementById('cli-apellido1').value;
    const apellido2 = document.getElementById('cli-apellido2').value;
    const dpi = document.getElementById('cli-dpi').value;

    const base = generarBaseUsername(nombres, apellido1, apellido2);
    if (!base || dpi.length < 3) {
        inputUsuario.value = '';
        inputUsuario.placeholder = 'Completa nombres, apellidos y DPI...';
        return;
    }

    inputUsuario.value = '';
    inputUsuario.placeholder = 'Generando...';

    temporizadorUsuario = setTimeout(async () => {
        const usuario = await generarUsernameUnico(base, dpi);
        // Evita pintar un resultado viejo si el cajero siguió escribiendo mientras tanto.
        if (base === generarBaseUsername(
            document.getElementById('cli-nombres').value,
            document.getElementById('cli-apellido1').value,
            document.getElementById('cli-apellido2').value
        ) && dpi === document.getElementById('cli-dpi').value) {
            inputUsuario.value = usuario;
        }
    }, 400);
}

/**
 * Normaliza a solo letras minúsculas sin acentos (María -> maria).
 */
function normalizarLetras(texto) {
    return (texto || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z]/g, '');
}

/**
 * Base del username: primeras 3 letras del nombre + inicial de cada apellido.
 */
function generarBaseUsername(nombres, apellido1, apellido2) {
    const letrasNombre = normalizarLetras(nombres).slice(0, 3);
    const inicial1 = normalizarLetras(apellido1).slice(0, 1);
    const inicial2 = normalizarLetras(apellido2).slice(0, 1);

    if (letrasNombre.length < 3 || !inicial1) return '';
    return letrasNombre + inicial1 + inicial2;
}

/**
 * Username = base + dígitos del DPI, empezando en 3 dígitos. Si ya existe,
 * se agrega un dígito más del DPI (hasta un tope de 6: el DPI es único por
 * ley, así que esto garantiza unicidad sin necesidad de exponerlo casi
 * completo). En el caso extremo de que ni así alcance, se agrega un sufijo
 * aleatorio de 2 caracteres en vez de seguir usando más DPI.
 */
async function generarUsernameUnico(base, dpi) {
    const TOPE_DIGITOS_DPI = 6;
    const maxDigitos = Math.min(dpi.length, TOPE_DIGITOS_DPI);

    for (let longitud = 3; longitud <= maxDigitos; longitud++) {
        const candidato = base + dpi.slice(0, longitud);
        if (await usernameDisponible(candidato)) return candidato;
    }

    // Caso extremo, prácticamente imposible con DPIs reales: nunca seguimos
    // agregando más dígitos del DPI, en vez de eso usamos un sufijo aleatorio.
    for (let intento = 0; intento < 5; intento++) {
        const sufijo = Array.from(window.crypto.getRandomValues(new Uint32Array(2)), v => (v % 36).toString(36)).join('');
        const candidato = base + dpi.slice(0, maxDigitos) + sufijo;
        if (await usernameDisponible(candidato)) return candidato;
    }

    return base + dpi.slice(0, maxDigitos) + Date.now().toString().slice(-4);
}

async function usernameDisponible(candidato) {
    const { data, error } = await supabaseClient
        .from('usuarios')
        .select('id_usuario')
        .eq('username', candidato)
        .maybeSingle();

    if (error) {
        console.error('Error verificando disponibilidad de username:', error);
        return false;
    }
    return !data;
}

function pintarUsuarioEnHeader() {
    const appMeta = sesionActual.user.app_metadata || {};
    const rol = appMeta.role || 'Trabajador';
    const codigo = appMeta.codigo_empleado || sesionActual.user.email.split('@')[0];

    document.getElementById('txtCodigoEmpleado').textContent = codigo;
    document.getElementById('badgeRol').textContent = rol;

    if (rol === 'Administrador') {
        document.getElementById('seccionCrearStaff').hidden = false;
        document.getElementById('seccionListaStaff').hidden = false;
        cargarUltimosCajeros();
    }
}

/**
 * Genera una contraseña temporal aleatoria y razonablemente segura,
 * usando crypto.getRandomValues en vez de Math.random.
 */
function generarPasswordSegura(longitud = 10) {
    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const valores = new Uint32Array(longitud);
    window.crypto.getRandomValues(valores);
    return Array.from(valores, v => alfabeto[v % alfabeto.length]).join('');
}

function generarNumeroCuenta() {
    const valores = new Uint32Array(1);
    window.crypto.getRandomValues(valores);
    const digitos = String(valores[0]).padStart(10, '0').slice(0, 9);
    return `40${digitos}`;
}

// ==========================================
// REGISTRAR CLIENTE
// ==========================================
async function manejarCrearCliente(e) {
    e.preventDefault();

    const btn = document.getElementById('btnCrearCliente');
    const contenedorResultado = document.getElementById('resultadoCliente');

    const nombres = document.getElementById('cli-nombres').value.trim();
    const apellido1 = document.getElementById('cli-apellido1').value.trim();
    const apellido2 = document.getElementById('cli-apellido2').value.trim();
    const apellidos = [apellido1, apellido2].filter(Boolean).join(' ');
    const dpi = document.getElementById('cli-dpi').value.trim();
    const fechaNacimiento = document.getElementById('cli-fecha-nacimiento').value;
    const telefonoDigitos = document.getElementById('cli-telefono').value.trim();
    const correo = document.getElementById('cli-correo').value.trim();
    const direccion = document.getElementById('cli-direccion').value.trim();

    if (dpi.length !== 13) {
        contenedorResultado.innerHTML = `<div class="resultado-box error">El DPI debe tener exactamente 13 dígitos.</div>`;
        return;
    }
    if (telefonoDigitos.length !== 8) {
        contenedorResultado.innerHTML = `<div class="resultado-box error">El teléfono debe tener exactamente 8 dígitos.</div>`;
        return;
    }

    const telefono = `+502${telefonoDigitos}`;

    btn.disabled = true;
    const original = btn.innerHTML;
    btn.innerText = "Registrando...";

    try {
        // Username: se re-verifica justo antes de insertar (no confiamos a
        // ciegas en el valor ya pintado, por si quedó desactualizado).
        const baseUsuario = generarBaseUsername(nombres, apellido1, apellido2);
        let usuario = await generarUsernameUnico(baseUsuario, dpi);

        // 1. Rol "Cliente"
        const { data: rolCliente, error: errRol } = await supabaseClient
            .from('roles')
            .select('id_rol')
            .eq('nombre_rol', 'Cliente')
            .maybeSingle();

        if (errRol || !rolCliente) {
            throw new Error("No se encontró el rol 'Cliente' en la tabla roles.");
        }

        // 2. Contraseña temporal, hasheada en el servidor (misma RPC que ya usaba el registro anterior)
        const passwordTemporal = generarPasswordSegura(10);
        const { data: passwordHasheada, error: errHash } = await supabaseClient
            .rpc('hash_password', { password: passwordTemporal });

        if (errHash || !passwordHasheada) {
            throw new Error("No se pudo procesar la contraseña de forma segura.");
        }

        // 3. Usuario (credenciales de acceso a la Banca en Línea).
        // Reintenta con un sufijo aleatorio si, por una carrera entre dos
        // registros simultáneos, el username ya fue tomado justo antes de insertar.
        let nuevoUsuario = null;
        for (let intento = 0; intento < 3 && !nuevoUsuario; intento++) {
            const { data, error: errUsuario } = await supabaseClient
                .from('usuarios')
                .insert([{
                    username: usuario,
                    email: correo,
                    password_hash: passwordHasheada,
                    estado_cuenta: 'Activa',
                    intentos_fallidos: 0,
                    requiere_mfa: false,
                    id_rol: rolCliente.id_rol
                }])
                .select('id_usuario')
                .single();

            if (!errUsuario) {
                nuevoUsuario = data;
            } else if (errUsuario.code === '23505') {
                const mensaje = (errUsuario.message || '').toLowerCase();
                if (mensaje.includes('email')) {
                    // Regenerar el username jamás va a arreglar un correo duplicado:
                    // avisamos de inmediato en vez de agotar los 3 intentos en vano.
                    throw new Error('Ya existe un usuario registrado con ese correo electrónico.');
                }
                // Colisión de username: probamos con un sufijo distinto.
                const sufijo = Array.from(window.crypto.getRandomValues(new Uint32Array(2)), v => (v % 36).toString(36)).join('');
                usuario = baseUsuario + dpi.slice(0, Math.min(dpi.length, 6)) + sufijo;
            } else {
                throw errUsuario;
            }
        }

        if (!nuevoUsuario) {
            throw new Error("No se pudo generar un usuario único. Intenta de nuevo.");
        }

        // 4. Perfil del cliente
        const { error: errPerfil } = await supabaseClient
            .from('perfiles_clientes')
            .insert([{
                dpi,
                nombres,
                apellidos,
                telefono,
                direccion,
                fecha_nacimiento: fechaNacimiento,
                id_usuario: nuevoUsuario.id_usuario
            }]);

        if (errPerfil) {
            if (errPerfil.code === '23505') {
                throw new Error('Ya existe un cliente registrado con ese DPI.');
            }
            throw errPerfil;
        }

        // 5. Cuenta monetaria inicial en Q0.00, con reintento simple si el número generado ya existe
        let numeroCuenta = null;
        for (let intento = 0; intento < 3 && !numeroCuenta; intento++) {
            const candidato = generarNumeroCuenta();
            const { error: errCuenta } = await supabaseClient
                .from('cuentas')
                .insert([{
                    numero_cuenta: candidato,
                    tipo_cuenta: 'Monetaria',
                    saldo_disponible: 0,
                    saldo_retenido: 0,
                    moneda: 'GTQ',
                    estado: 'Activa',
                    dpi_cliente: dpi
                }]);

            if (!errCuenta) {
                numeroCuenta = candidato;
            } else if (errCuenta.code !== '23505') {
                throw errCuenta;
            }
        }

        if (!numeroCuenta) {
            throw new Error("No se pudo asignar un número de cuenta disponible. Intenta de nuevo.");
        }

        contenedorResultado.innerHTML = `
            <div class="resultado-box">
                <strong>Cliente registrado con éxito. Entrégale estos datos:</strong>
                Usuario: <code>${usuario}</code><br>
                Contraseña temporal: <code>${passwordTemporal}</code><br>
                Cuenta Monetaria: <code>${numeroCuenta}</code> (Q 0.00)
            </div>
        `;
        document.getElementById('form-crear-cliente').reset();

    } catch (err) {
        console.error("Error al registrar cliente:", err);
        contenedorResultado.innerHTML = `
            <div class="resultado-box error">
                <strong>No se pudo completar el registro</strong>
                ${err.message || err}
            </div>
        `;
    } finally {
        btn.disabled = false;
        btn.innerHTML = original;
    }
}

// ==========================================
// ALTA DE CAJEROS (solo Administrador)
// ==========================================
async function manejarCrearStaff(e) {
    e.preventDefault();

    const btn = document.getElementById('btnCrearStaff');
    const contenedorResultado = document.getElementById('resultadoStaff');
    const cantidad = parseInt(document.getElementById('cantidad-cajeros').value, 10);

    if (!cantidad || cantidad < 1 || cantidad > 50) {
        contenedorResultado.innerHTML = `<div class="resultado-box error">Ingresa una cantidad entre 1 y 50.</div>`;
        return;
    }

    btn.disabled = true;
    const original = btn.innerHTML;
    btn.innerText = "Generando...";

    try {
        const { data, error } = await supabaseClient.functions.invoke('crear-cajeros-lote', {
            body: { cantidad }
        });

        if (error) throw error;

        const creados = data?.creados || [];
        const errores = data?.errores || [];

        if (creados.length === 0) {
            contenedorResultado.innerHTML = `<div class="resultado-box error">No se pudo crear ningún cajero. ${errores.join(', ')}</div>`;
            return;
        }

        const filas = creados.map(c => `
            <tr>
                <td><code>${c.codigo_empleado}</code></td>
                <td><code>${c.password}</code>
                    <button type="button" class="btn-copy" data-copiar="${c.codigo_empleado} / ${c.password}">Copiar</button>
                </td>
            </tr>
        `).join('');

        contenedorResultado.innerHTML = `
            <div class="resultado-box">
                <strong>${creados.length} cajero(s) creado(s). Guarda o imprime esto: no se vuelve a mostrar.</strong>
                <table class="tabla-credenciales">
                    <thead><tr><th>Código</th><th>Contraseña</th></tr></thead>
                    <tbody>${filas}</tbody>
                </table>
                ${errores.length ? `<p style="margin-top:0.75rem;color:var(--color-danger);">${errores.length} fallaron: ${errores.join(', ')}</p>` : ''}
            </div>
        `;

        contenedorResultado.querySelectorAll('[data-copiar]').forEach(boton => {
            boton.addEventListener('click', () => {
                navigator.clipboard.writeText(boton.dataset.copiar);
                boton.textContent = 'Copiado';
                setTimeout(() => { boton.textContent = 'Copiar'; }, 1500);
            });
        });

        document.getElementById('form-crear-staff').reset();
        document.getElementById('cantidad-cajeros').value = 1;

        cargarUltimosCajeros();

    } catch (err) {
        console.error("Error al crear cajeros:", err);
        contenedorResultado.innerHTML = `
            <div class="resultado-box error">
                <strong>No se pudo completar la operación</strong>
                ${err.message || err}
            </div>
        `;
    } finally {
        btn.disabled = false;
        btn.innerHTML = original;
    }
}

// ==========================================
// LISTADO / BÚSQUEDA DE CAJEROS (solo Administrador)
// ==========================================
function renderizarTablaCajeros(cajeros) {
    const contenedor = document.getElementById('resultadoListaStaff');

    if (cajeros.length === 0) {
        contenedor.innerHTML = `<div class="resultado-box error">No se encontraron cajeros.</div>`;
        return;
    }

    const filas = cajeros.map(c => `
        <tr>
            <td><code>${c.codigo_empleado}</code></td>
            <td>${c.puesto || '-'}</td>
            <td>${c.area || '-'}</td>
            <td>${c.fecha_contratacion || '-'}</td>
        </tr>
    `).join('');

    contenedor.innerHTML = `
        <table class="tabla-credenciales">
            <thead><tr><th>Código</th><th>Puesto</th><th>Área</th><th>Fecha de alta</th></tr></thead>
            <tbody>${filas}</tbody>
        </table>
    `;
}

async function cargarUltimosCajeros() {
    const contenedor = document.getElementById('resultadoListaStaff');
    contenedor.innerHTML = `<p class="section-desc">Cargando...</p>`;

    const { data, error } = await supabaseClient
        .from('perfiles_empleados')
        .select('codigo_empleado, puesto, area, fecha_contratacion')
        .not('auth_uid', 'is', null)
        .order('codigo_empleado', { ascending: false })
        .limit(20);

    if (error) {
        console.error("Error al cargar cajeros:", error);
        contenedor.innerHTML = `<div class="resultado-box error">No se pudo cargar el listado de cajeros.</div>`;
        return;
    }

    renderizarTablaCajeros(data || []);
}

async function manejarBuscarStaff(e) {
    e.preventDefault();

    const termino = document.getElementById('buscar-codigo').value.trim();
    if (!termino) {
        cargarUltimosCajeros();
        return;
    }

    const contenedor = document.getElementById('resultadoListaStaff');
    contenedor.innerHTML = `<p class="section-desc">Buscando...</p>`;

    const { data, error } = await supabaseClient
        .from('perfiles_empleados')
        .select('codigo_empleado, puesto, area, fecha_contratacion')
        .not('auth_uid', 'is', null)
        .ilike('codigo_empleado', `%${termino}%`)
        .order('codigo_empleado', { ascending: false })
        .limit(20);

    if (error) {
        console.error("Error al buscar cajero:", error);
        contenedor.innerHTML = `<div class="resultado-box error">No se pudo completar la búsqueda.</div>`;
        return;
    }

    renderizarTablaCajeros(data || []);
}
