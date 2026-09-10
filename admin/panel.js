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

    const rolSesion = data.session.user?.app_metadata?.role;
    if (!['Trabajador', 'Supervisor', 'Administrador'].includes(rolSesion)) {
        await supabaseClient.auth.signOut();
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
    inicializarNotificaciones();
    inicializarNavegacionPanel();
    inicializarDepositos();
});

// ==========================================
// BARRA LATERAL Y VISTAS DEL PANEL
// ==========================================
// El panel tenía las 5 secciones apiladas una tras otra, así que había que
// bajar mucho para llegar a cualquier cosa (y con cientos de solicitudes
// pendientes, todavía más). Ahora la barra lateral elige qué vista se muestra
// y el resto queda fuera de pantalla.

const LLAVE_VISTA_PANEL = 'uvg-panel-vista';
const LLAVE_SIDEBAR_PANEL = 'uvg-panel-sidebar-colapsado';
const ANCHO_MOVIL_PANEL = 900;

function inicializarNavegacionPanel() {
    const layout = document.getElementById('panelLayout');
    const boton = document.getElementById('btnTogglePanelSidebar');
    const scrim = document.getElementById('scrimPanel');
    if (!layout || !boton) return;

    const esMovil = () => window.innerWidth <= ANCHO_MOVIL_PANEL;

    const sincronizar = () => {
        const colapsado = layout.classList.contains('sidebar-colapsado');
        const abierto = layout.classList.contains('sidebar-abierto');
        boton.setAttribute('aria-expanded', String(esMovil() ? abierto : !colapsado));
        if (scrim) scrim.hidden = !abierto;

        // Colapsada, la barra es solo iconos: el title es lo único que dice
        // a qué vista lleva cada uno.
        const soloIconos = esMovil() ? !abierto : colapsado;
        document.querySelectorAll('.panel-nav-btn').forEach(b => {
            const etiqueta = b.querySelector('span')?.textContent.trim();
            if (!etiqueta) return;
            if (soloIconos) b.setAttribute('title', etiqueta);
            else b.removeAttribute('title');
        });
    };

    try {
        if (localStorage.getItem(LLAVE_SIDEBAR_PANEL) === '1') {
            layout.classList.add('sidebar-colapsado');
        }
    } catch (err) {
        // Sin preferencia guardada: se queda expandida.
    }

    boton.addEventListener('click', () => {
        if (esMovil()) {
            layout.classList.toggle('sidebar-abierto');
        } else {
            const colapsado = layout.classList.toggle('sidebar-colapsado');
            try {
                localStorage.setItem(LLAVE_SIDEBAR_PANEL, colapsado ? '1' : '0');
            } catch (err) {
                // El toggle igual funciona en esta carga.
            }
        }
        sincronizar();
    });

    scrim?.addEventListener('click', () => {
        layout.classList.remove('sidebar-abierto');
        sincronizar();
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && layout.classList.contains('sidebar-abierto')) {
            layout.classList.remove('sidebar-abierto');
            sincronizar();
        }
    });

    window.addEventListener('resize', () => {
        if (!esMovil()) layout.classList.remove('sidebar-abierto');
        sincronizar();
    });

    document.querySelectorAll('.panel-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            mostrarVistaPanel(btn.dataset.vista);
            // En celular, elegir una vista cierra el cajón: si no, quedaría
            // tapando justo lo que se acaba de abrir.
            if (esMovil()) {
                layout.classList.remove('sidebar-abierto');
                sincronizar();
            }
        });
    });

    // Se recupera la última vista usada, pero solo si el rol de esta sesión
    // realmente la tiene disponible (un Trabajador no puede caer en el
    // dashboard de administrador por lo que quedó guardado en su navegador).
    let vistaInicial = null;
    try {
        vistaInicial = localStorage.getItem(LLAVE_VISTA_PANEL);
    } catch (err) {
        vistaInicial = null;
    }
    if (!vistaInicial || !vistaPanelDisponible(vistaInicial)) {
        vistaInicial = 'seccionNotificaciones';
    }
    mostrarVistaPanel(vistaInicial);

    sincronizar();
}

/** ¿La vista está habilitada para el rol de esta sesión? */
function vistaPanelDisponible(idSeccion) {
    const boton = document.querySelector(`.panel-nav-btn[data-vista="${idSeccion}"]`);
    return !!boton && !boton.closest('li')?.hidden;
}

function mostrarVistaPanel(idSeccion) {
    if (!vistaPanelDisponible(idSeccion)) return;

    document.querySelectorAll('.panel-section').forEach(sec => {
        sec.classList.toggle('vista-activa', sec.id === idSeccion);
    });

    document.querySelectorAll('.panel-nav-btn').forEach(b => {
        const activo = b.dataset.vista === idSeccion;
        b.classList.toggle('active', activo);
        b.setAttribute('aria-current', activo ? 'page' : 'false');
    });

    try {
        localStorage.setItem(LLAVE_VISTA_PANEL, idSeccion);
    } catch (err) {
        // Sin persistencia: la vista igual cambió en esta carga.
    }

    document.querySelector('.panel-content')?.scrollTo({ top: 0 });
}

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

    // El gate de rol vive en la barra lateral, no en las secciones: la
    // visibilidad de las secciones la maneja el cambio de vista, así que si
    // se siguiera usando `hidden` acá las dos cosas se pelearían.
    if (rol === 'Administrador') {
        ['dashboard', 'crearStaff', 'listaStaff'].forEach(nav => {
            const item = document.querySelector(`li[data-nav="${nav}"]`);
            if (item) item.hidden = false;
        });
        cargarUltimosCajeros();
        cargarDashboardAdmin();
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

    if (window.UVGMotion) window.UVGMotion.setButtonState(btn, 'loading');

    try {
        // Username: se re-verifica justo antes de insertar (no confiamos a
        // ciegas en el valor ya pintado, por si quedó desactualizado).
        const baseUsuario = generarBaseUsername(nombres, apellido1, apellido2);
        let usuario = await generarUsernameUnico(baseUsuario, dpi);

        // El backend realiza el alta completa y elimina la identidad Auth si
        // falla el usuario, el perfil o la cuenta bancaria.
        const { data: identidad, error: errIdentidad } = await supabaseClient.functions.invoke('crear-cliente', {
            body: {
                nombres, apellidos, dpi, telefono, correo, direccion,
                fecha_nacimiento: fechaNacimiento,
                username: usuario
            }
        });

        if (errIdentidad) {
            let detalle = errIdentidad.message;
            try {
                const respuesta = await errIdentidad.context?.json();
                detalle = respuesta?.error || detalle;
            } catch (_) { /* La respuesta puede no contener JSON. */ }
            throw new Error(detalle || 'No se pudo crear el acceso del cliente.');
        }
        if (!identidad?.username || !identidad?.password || !identidad?.numero_cuenta) {
            throw new Error('El servidor devolvió una respuesta incompleta.');
        }

        contenedorResultado.innerHTML = `
            <div class="resultado-box">
                <strong>Cliente registrado con éxito. Entrégale estos datos:</strong>
                Usuario: <code>${identidad.username}</code><br>
                Contraseña temporal: <code>${identidad.password}</code><br>
                Cuenta Monetaria: <code>${identidad.numero_cuenta}</code> (Q 0.00)
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
        if (window.UVGMotion) window.UVGMotion.setButtonState(btn, null);
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

    if (window.UVGMotion) window.UVGMotion.setButtonState(btn, 'loading');

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
        if (window.UVGMotion) window.UVGMotion.setButtonState(btn, null);
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

const SKELETON_TABLA = `
    <div class="skeleton-line" style="width:90%"></div>
    <div class="skeleton-line" style="width:75%"></div>
    <div class="skeleton-line" style="width:82%"></div>
`;

async function cargarUltimosCajeros() {
    const contenedor = document.getElementById('resultadoListaStaff');
    contenedor.innerHTML = SKELETON_TABLA;

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
    contenedor.innerHTML = SKELETON_TABLA;

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

// ==========================================
// SOLICITUDES PENDIENTES / NOTIFICACIONES (todo el staff)
// ==========================================
const TABLA_POR_TIPO = {
    cuentas: 'solicitudes_cuentas',
    prestamos: 'solicitudes_prestamos',
    productos: 'solicitudes_productos'
};

let tipoActivoNotificaciones = 'cuentas';

function inicializarNotificaciones() {
    document.querySelectorAll('.tab-notif-btn').forEach(boton => {
        boton.addEventListener('click', () => {
            document.querySelectorAll('.tab-notif-btn').forEach(b => b.classList.remove('active'));
            boton.classList.add('active');
            tipoActivoNotificaciones = boton.dataset.tipo;
            cargarListaPendientes(tipoActivoNotificaciones);
        });
    });

    const btnCampana = document.getElementById('btnCampana');
    if (btnCampana) {
        // Ya no sirve hacer scroll: la sección solo existe en pantalla cuando
        // es la vista activa, así que la campana cambia de vista.
        btnCampana.addEventListener('click', () => mostrarVistaPanel('seccionNotificaciones'));
    }

    // La primera carga abre la pestaña que de verdad tiene algo pendiente:
    // caer en "Apertura de cuenta (0)" mientras el título dice "16
    // pendientes" hacía parecer que el listado estaba roto.
    primeraCargaNotificaciones();

    // Se refresca solo cada minuto, sin necesidad de recargar la página.
    setInterval(() => {
        actualizarContadoresPendientes();
        cargarListaPendientes(tipoActivoNotificaciones);
    }, 60000);
}

async function primeraCargaNotificaciones() {
    const conteos = await actualizarContadoresPendientes();

    const primeroConPendientes = ['cuentas', 'prestamos', 'productos']
        .find(tipo => (conteos?.[tipo] || 0) > 0);

    if (primeroConPendientes && primeroConPendientes !== tipoActivoNotificaciones) {
        activarPestanaNotificaciones(primeroConPendientes);
    } else {
        cargarListaPendientes(tipoActivoNotificaciones);
    }
}

function activarPestanaNotificaciones(tipo) {
    document.querySelectorAll('.tab-notif-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tipo === tipo);
    });
    tipoActivoNotificaciones = tipo;
    cargarListaPendientes(tipo);
}

async function actualizarContadoresPendientes() {
    const [cuentas, prestamos, productos] = await Promise.all([
        contarPendientes('solicitudes_cuentas'),
        contarPendientes('solicitudes_prestamos'),
        contarPendientes('solicitudes_productos')
    ]);

    document.getElementById('countTabCuentas').textContent = cuentas;
    document.getElementById('countTabPrestamos').textContent = prestamos;
    document.getElementById('countTabProductos').textContent = productos;

    const total = cuentas + prestamos + productos;
    document.getElementById('badgeContadorPendientes').textContent = total;

    const badgeCampana = document.getElementById('badgeCampana');
    if (badgeCampana) {
        badgeCampana.textContent = total > 99 ? '99+' : String(total);
        badgeCampana.hidden = total === 0;
    }

    // Mismo contador en la barra lateral: con la vista de notificaciones
    // cerrada, es la única señal de que hay algo esperando.
    const navBadge = document.getElementById('navBadgePendientes');
    if (navBadge) {
        navBadge.textContent = total > 99 ? '99+' : String(total);
        navBadge.hidden = total === 0;
    }

    return { cuentas, prestamos, productos, total };
}

async function contarPendientes(tabla) {
    const { count, error } = await supabaseClient
        .from(tabla)
        .select('*', { count: 'exact', head: true })
        .eq('estado', 'Pendiente');

    if (error) {
        console.error(`Error al contar pendientes de ${tabla}:`, error);
        return 0;
    }
    return count || 0;
}

async function cargarListaPendientes(tipo) {
    const contenedor = document.getElementById('listaPendientes');
    contenedor.innerHTML = `
        <div class="skeleton-row"><div style="flex:1"><div class="skeleton-line" style="width:45%"></div><div class="skeleton-line" style="width:65%"></div></div></div>
        <div class="skeleton-row"><div style="flex:1"><div class="skeleton-line" style="width:40%"></div><div class="skeleton-line" style="width:55%"></div></div></div>
    `;

    const tabla = TABLA_POR_TIPO[tipo];
    const { data: solicitudes, error } = await supabaseClient
        .from(tabla)
        .select('*')
        .eq('estado', 'Pendiente')
        .order('fecha_solicitud', { ascending: false })
        .limit(50);

    if (error) {
        console.error(`Error al cargar ${tabla}:`, error);
        contenedor.innerHTML = '<div class="resultado-box error">No se pudo cargar el listado.</div>';
        return;
    }

    if (!solicitudes || solicitudes.length === 0) {
        contenedor.innerHTML = '<p class="section-desc">No hay solicitudes pendientes en esta categoría.</p>';
        return;
    }

    // Resolver el nombre del cliente para cada solicitud (id_usuario -> nombre)
    const idsUsuarios = [...new Set(solicitudes.map(s => s.id_usuario).filter(Boolean))];
    const mapaNombres = await resolverNombresClientes(idsUsuarios);

    // Nunca se arma este listado con innerHTML + texto interpolado: nombre,
    // producto y propósito vienen de solicitudes que cualquiera puede
    // insertar (incluso sin pasar por el sitio), así que se construyen como
    // nodos de DOM reales con textContent -- si alguien manda
    // "<img src=x onerror=...>" como propósito, se muestra como texto
    // literal en vez de ejecutarse en la sesión del cajero.
    contenedor.innerHTML = '';
    solicitudes.forEach(s => {
        const fila = renderizarFilaSolicitud(tipo, s, mapaNombres);
        fila.querySelectorAll('[data-accion]').forEach(boton => {
            boton.addEventListener('click', () => {
                const { accion, id, tipo: tipoBoton } = boton.dataset;
                manejarDecisionSolicitud(tipoBoton, id, accion === 'aprobar' ? 'Aprobada' : 'Rechazada', boton);
            });
        });
        contenedor.appendChild(fila);
    });
}

async function resolverNombresClientes(idsUsuarios) {
    const mapa = {};
    if (idsUsuarios.length === 0) return mapa;

    const { data, error } = await supabaseClient
        .from('perfiles_clientes')
        .select('id_usuario, nombres, apellidos')
        .in('id_usuario', idsUsuarios);

    if (error) {
        console.error('Error al resolver nombres de clientes:', error);
        return mapa;
    }

    (data || []).forEach(p => { mapa[p.id_usuario] = `${p.nombres} ${p.apellidos}`; });
    return mapa;
}

/**
 * Devuelve un elemento de DOM (no un string de HTML). Todo lo que puede
 * venir de una solicitud insertada por cualquiera con el anon key
 * (nombre_producto, proposito, nombre_producto_solicitado, el nombre del
 * cliente) se asigna con textContent -- nunca se concatena dentro de HTML.
 */
function renderizarFilaSolicitud(tipo, s, mapaNombres) {
    const nombreCliente = mapaNombres[s.id_usuario] || 'Cliente no identificado';
    const fecha = s.fecha_solicitud ? new Date(s.fecha_solicitud).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' }) : '';

    let detalle = '';
    if (tipo === 'cuentas') {
        detalle = `${s.nombre_producto || 'Cuenta'} · ${s.moneda || 'GTQ'}` +
            (s.monto_inicial ? ` · Monto inicial: ${Number(s.monto_inicial).toLocaleString('es-GT')}` : '') +
            (s.proposito ? ` · ${s.proposito}` : '');
    } else if (tipo === 'prestamos') {
        detalle = `${s.nombre_producto || 'Préstamo'} · Q${Number(s.monto_solicitado || 0).toLocaleString('es-GT')} a ${s.plazo_meses || '-'} meses`;
    } else {
        // Las gestiones (chequera, reposición de tarjeta) traen el dato que el
        // cajero necesita para atenderlas en `dato_adicional_*` y en la
        // entrega. Sin esto la fila decía "Chequera de 25 cheques" y nada más,
        // así que había que ir a buscar la cuenta a otra parte.
        const partes = [s.nombre_producto_solicitado || 'Solicitud'];
        if (s.dato_adicional_etiqueta && s.dato_adicional_valor) {
            partes.push(`${s.dato_adicional_etiqueta}: ${s.dato_adicional_valor}`);
        }
        if (s.direccion_entrega) partes.push(`Entrega: ${s.direccion_entrega}`);
        if (s.telefono_contacto) partes.push(`Tel: ${s.telefono_contacto}`);
        detalle = partes.join(' · ');
    }

    const fila = document.createElement('div');
    fila.className = 'solicitud-item';

    const info = document.createElement('div');
    info.className = 'solicitud-info';

    const nombreEl = document.createElement('strong');
    nombreEl.textContent = nombreCliente;
    const detalleEl = document.createElement('small');
    detalleEl.textContent = detalle;
    const fechaEl = document.createElement('small');
    fechaEl.textContent = fecha;

    info.append(nombreEl, detalleEl, document.createElement('br'), fechaEl);

    const acciones = document.createElement('div');
    acciones.className = 'solicitud-acciones';

    const btnAprobar = document.createElement('button');
    btnAprobar.className = 'btn-aprobar';
    btnAprobar.dataset.accion = 'aprobar';
    btnAprobar.dataset.tipo = tipo;
    btnAprobar.dataset.id = s.id_solicitud;
    btnAprobar.innerHTML = '<i class="ri-check-line"></i> Aprobar'; // estático, no lleva datos de usuario

    const btnRechazar = document.createElement('button');
    btnRechazar.className = 'btn-rechazar';
    btnRechazar.dataset.accion = 'rechazar';
    btnRechazar.dataset.tipo = tipo;
    btnRechazar.dataset.id = s.id_solicitud;
    btnRechazar.innerHTML = '<i class="ri-close-line"></i> Rechazar';

    acciones.append(btnAprobar, btnRechazar);
    fila.append(info, acciones);

    return fila;
}

async function manejarDecisionSolicitud(tipo, idSolicitud, nuevoEstado, botonOrigen) {
    const contenedorBotones = botonOrigen.closest('.solicitud-acciones');
    contenedorBotones.querySelectorAll('button').forEach(b => b.disabled = true);

    try {
        if (nuevoEstado === 'Aprobada' && tipo === 'cuentas') {
            await aprobarSolicitudCuenta(idSolicitud);
        } else {
            const tabla = TABLA_POR_TIPO[tipo];
            const { error } = await supabaseClient
                .from(tabla)
                .update({ estado: nuevoEstado })
                .eq('id_solicitud', idSolicitud);
            if (error) throw error;
        }

        await cargarListaPendientes(tipo);
        await actualizarContadoresPendientes();

    } catch (err) {
        console.error('Error al actualizar la solicitud:', err);
        alert('No se pudo completar la acción: ' + (err.message || err));
        contenedorBotones.querySelectorAll('button').forEach(b => b.disabled = false);
    }
}

/**
 * Aprobar una solicitud de apertura de cuenta no solo cambia el estado:
 * también crea la cuenta real, porque ese es el resultado que el cliente
 * espera. Préstamos y tarjetas todavía no tienen una tabla de "productos
 * activos" en el esquema (issuance de tarjeta, desembolso de préstamo), así
 * que ahí por ahora solo se actualiza el estado.
 */
async function aprobarSolicitudCuenta(idSolicitud) {
    const { data: solicitud, error: errSolicitud } = await supabaseClient
        .from('solicitudes_cuentas')
        .select('*')
        .eq('id_solicitud', idSolicitud)
        .single();

    if (errSolicitud) throw errSolicitud;

    const { data: perfil, error: errPerfil } = await supabaseClient
        .from('perfiles_clientes')
        .select('dpi')
        .eq('id_usuario', solicitud.id_usuario)
        .maybeSingle();

    if (errPerfil || !perfil) {
        throw new Error('No se encontró el perfil del cliente que hizo la solicitud.');
    }

    let numeroCuenta = null;
    for (let intento = 0; intento < 3 && !numeroCuenta; intento++) {
        const candidato = generarNumeroCuenta();
        const { error: errCuenta } = await supabaseClient
            .from('cuentas')
            .insert([{
                numero_cuenta: candidato,
                tipo_cuenta: mapearTipoCuenta(solicitud.nombre_producto),
                saldo_disponible: solicitud.monto_inicial || 0,
                saldo_retenido: 0,
                moneda: solicitud.moneda || 'GTQ',
                estado: 'Activa',
                dpi_cliente: perfil.dpi
            }]);

        if (!errCuenta) {
            numeroCuenta = candidato;
        } else if (errCuenta.code !== '23505') {
            throw errCuenta;
        }
    }

    if (!numeroCuenta) {
        throw new Error('No se pudo asignar un número de cuenta disponible.');
    }

    const { error: errUpdate } = await supabaseClient
        .from('solicitudes_cuentas')
        .update({ estado: 'Aprobada' })
        .eq('id_solicitud', idSolicitud);

    if (errUpdate) throw errUpdate;

    alert(`Cuenta creada con éxito: ${numeroCuenta}`);
}

function mapearTipoCuenta(nombreProducto) {
    const nombre = (nombreProducto || '').toLowerCase();
    if (nombre.includes('ahorro')) return 'Ahorro';
    if (nombre.includes('plazo')) return 'Plazo Fijo';
    return 'Monetaria';
}

// ==========================================
// DASHBOARD / RESUMEN GENERAL (solo Administrador)
// ==========================================
async function cargarDashboardAdmin() {
    await Promise.all([
        cargarKpis(),
        cargarChartCuentasPorTipo(),
        cargarChartClientesPorMes()
    ]);
}

async function cargarKpis() {
    const contenedor = document.getElementById('kpiRow');

    const [clientes, cuentasActivas, saldoGtq, cajeros, pendientes] = await Promise.all([
        supabaseClient.from('perfiles_clientes').select('*', { count: 'exact', head: true }),
        supabaseClient.from('cuentas').select('*', { count: 'exact', head: true }).eq('estado', 'Activa'),
        supabaseClient.from('cuentas').select('saldo_disponible').eq('moneda', 'GTQ'),
        supabaseClient.from('perfiles_empleados').select('*', { count: 'exact', head: true }).not('auth_uid', 'is', null),
        Promise.all([
            contarPendientes('solicitudes_cuentas'),
            contarPendientes('solicitudes_prestamos'),
            contarPendientes('solicitudes_productos')
        ]).then(vals => vals.reduce((a, b) => a + b, 0))
    ]);

    const totalSaldoGtq = (saldoGtq.data || []).reduce((acc, c) => acc + parseFloat(c.saldo_disponible || 0), 0);

    const tiles = [
        { label: 'Clientes', value: formatoCompacto(clientes.count || 0) },
        { label: 'Cuentas activas', value: formatoCompacto(cuentasActivas.count || 0) },
        { label: 'Saldo total (GTQ)', value: 'Q ' + formatoCompacto(totalSaldoGtq) },
        { label: 'Cajeros activos', value: formatoCompacto(cajeros.count || 0) },
        { label: 'Solicitudes pendientes', value: formatoCompacto(pendientes), warning: pendientes > 0 }
    ];

    contenedor.innerHTML = tiles.map(t => `
        <div class="kpi-tile ${t.warning ? 'kpi-warning' : ''}">
            <span class="kpi-label">${t.warning ? '<i class="ri-error-warning-line"></i> ' : ''}${t.label}</span>
            <span class="kpi-value">${t.value}</span>
        </div>
    `).join('');
}

function formatoCompacto(numero) {
    const n = Number(numero) || 0;
    if (n >= 1000000) return (n / 1000000).toLocaleString('es-GT', { maximumFractionDigits: 1 }) + 'M';
    if (n >= 1000) return (n / 1000).toLocaleString('es-GT', { maximumFractionDigits: 1 }) + 'K';
    return n.toLocaleString('es-GT');
}

async function cargarChartCuentasPorTipo() {
    const { data, error } = await supabaseClient.from('cuentas').select('tipo_cuenta');
    if (error) {
        console.error('Error al cargar cuentas por tipo:', error);
        return;
    }

    const conteo = {};
    (data || []).forEach(c => { conteo[c.tipo_cuenta] = (conteo[c.tipo_cuenta] || 0) + 1; });

    const puntos = Object.keys(conteo).map(tipo => ({ etiqueta: tipo, valor: conteo[tipo] }));
    dibujarBarrasSimples('chartCuentasPorTipo', puntos, { hue: 'var(--series-blue)' });
}

async function cargarChartClientesPorMes() {
    const { data, error } = await supabaseClient.from('perfiles_clientes').select('fecha_registro');
    if (error) {
        console.error('Error al cargar clientes por mes:', error);
        return;
    }

    const conteo = {};
    (data || []).forEach(p => {
        if (!p.fecha_registro) return;
        const clave = p.fecha_registro.slice(0, 7); // YYYY-MM
        conteo[clave] = (conteo[clave] || 0) + 1;
    });

    const NOMBRES_MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const puntos = Object.keys(conteo).sort().map(clave => {
        const [anio, mes] = clave.split('-');
        return { etiqueta: `${NOMBRES_MES_CORTO[parseInt(mes, 10) - 1]} ${anio.slice(2)}`, valor: conteo[clave] };
    });

    dibujarBarrasSimples('chartClientesPorMes', puntos, { hue: 'var(--series-orange)' });
}

/**
 * Gráfica de barras simple (una sola serie), en SVG puro, siguiendo el spec
 * del skill de dataviz: barras <=24px de grosor, extremo superior redondeado
 * (4px) y cuadrado en la base, etiqueta de valor en la punta de cada barra,
 * y tooltip real por barra (mouse + teclado).
 */
function dibujarBarrasSimples(idContenedor, puntos, opciones) {
    const contenedor = document.getElementById(idContenedor);
    if (!contenedor) return;

    if (!puntos || puntos.length === 0) {
        contenedor.innerHTML = '<p class="section-desc">Sin datos todavía.</p>';
        return;
    }

    const hue = (opciones && opciones.hue) || 'var(--series-blue)';
    const ancho = 320;
    const alto = 200;
    const margenInferior = 28;
    const margenSuperior = 24;
    const altoGrafico = alto - margenInferior - margenSuperior;
    const maxValor = Math.max(...puntos.map(p => p.valor), 1);

    const anchoFranja = ancho / puntos.length;
    const anchoBarra = Math.min(24, anchoFranja * 0.55);

    let barrasSvg = '';
    const datosBarras = [];

    puntos.forEach((p, i) => {
        const alturaBarra = Math.max(2, (p.valor / maxValor) * altoGrafico);
        const xCentro = anchoFranja * i + anchoFranja / 2;
        const x = xCentro - anchoBarra / 2;
        const yTop = alto - margenInferior - alturaBarra;
        const r = Math.min(4, anchoBarra / 2, alturaBarra);

        const path = `M ${x} ${alto - margenInferior}
            L ${x} ${yTop + r}
            Q ${x} ${yTop} ${x + r} ${yTop}
            L ${x + anchoBarra - r} ${yTop}
            Q ${x + anchoBarra} ${yTop} ${x + anchoBarra} ${yTop + r}
            L ${x + anchoBarra} ${alto - margenInferior}
            Z`;

        barrasSvg += `
            <path class="chart-bar" d="${path}" fill="${hue}"
                tabindex="0" role="img" aria-label="${p.etiqueta}: ${p.valor}"
                data-etiqueta="${p.etiqueta}" data-valor="${p.valor}"
                data-cx="${xCentro}" data-ytop="${yTop}"></path>
            <text class="chart-value-label" x="${xCentro}" y="${yTop - 6}" text-anchor="middle">${p.valor}</text>
            <text class="chart-axis-label" x="${xCentro}" y="${alto - margenInferior + 16}" text-anchor="middle">${p.etiqueta}</text>
        `;

        datosBarras.push({ etiqueta: p.etiqueta, valor: p.valor });
    });

    contenedor.innerHTML = `
        <svg viewBox="0 0 ${ancho} ${alto}" preserveAspectRatio="xMidYMid meet">
            <line x1="0" y1="${alto - margenInferior}" x2="${ancho}" y2="${alto - margenInferior}" stroke="var(--baseline)" stroke-width="1"></line>
            ${barrasSvg}
        </svg>
    `;

    // Tooltip compartido para todas las barras de esta gráfica
    let tooltip = contenedor.parentElement.querySelector('.chart-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'chart-tooltip';
        contenedor.parentElement.style.position = 'relative';
        contenedor.parentElement.appendChild(tooltip);
    }

    const mostrarTooltip = (barra) => {
        const etiqueta = barra.dataset.etiqueta;
        const valor = barra.dataset.valor;
        tooltip.innerHTML = '';
        const fuerte = document.createElement('strong');
        fuerte.textContent = valor;
        const debil = document.createElement('span');
        debil.textContent = etiqueta;
        tooltip.appendChild(fuerte);
        tooltip.appendChild(debil);

        const svgEl = contenedor.querySelector('svg');
        const rectSvg = svgEl.getBoundingClientRect();
        const rectContenedor = contenedor.parentElement.getBoundingClientRect();
        const escala = rectSvg.width / ancho;
        const cx = parseFloat(barra.dataset.cx) * escala;
        const yTop = parseFloat(barra.dataset.ytop) * escala;

        tooltip.style.left = (rectSvg.left - rectContenedor.left + cx) + 'px';
        tooltip.style.top = (rectSvg.top - rectContenedor.top + yTop) + 'px';
        tooltip.classList.add('visible');
    };
    const ocultarTooltip = () => tooltip.classList.remove('visible');

    contenedor.querySelectorAll('.chart-bar').forEach(barra => {
        barra.addEventListener('pointerenter', () => mostrarTooltip(barra));
        barra.addEventListener('pointerleave', ocultarTooltip);
        barra.addEventListener('focus', () => mostrarTooltip(barra));
        barra.addEventListener('blur', ocultarTooltip);
    });
}

// ==========================================
// DEPÓSITOS EN EFECTIVO (Trabajador, Supervisor, Administrador)
// ==========================================
// El staff acredita saldo real a la cuenta de un cliente. Todo el crédito
// pasa por la RPC `depositar_a_cuenta` (SECURITY DEFINER): el staff no tiene
// (ni debe tener) UPDATE directo sobre cuentas.saldo_disponible, así que no
// hay forma de fabricar saldo desde este navegador sin pasar por ahí.

const MONTO_MAXIMO_DEPOSITO = 100000;
let cuentaDepositoActual = null; // cache de la última cuenta consultada
let temporizadorCuentaDeposito = null;

function inicializarDepositos() {
    const inputCuenta = document.getElementById('dep-cuenta');
    const inputMonto = document.getElementById('dep-monto');
    const form = document.getElementById('form-deposito');

    inputCuenta.addEventListener('input', () => {
        clearTimeout(temporizadorCuentaDeposito);
        temporizadorCuentaDeposito = setTimeout(buscarCuentaDeposito, 400);
    });

    inputMonto.addEventListener('input', () => {
        const monto = parseFloat(inputMonto.value);
        if (inputMonto.value && monto > MONTO_MAXIMO_DEPOSITO) {
            inputMonto.setCustomValidity(`El monto máximo por depósito es Q ${MONTO_MAXIMO_DEPOSITO.toLocaleString('es-GT')}.`);
        } else {
            inputMonto.setCustomValidity('');
        }
    });

    form.addEventListener('submit', manejarSubmitDeposito);

    document.getElementById('btnDescargarVoucherDeposito').addEventListener('click', descargarVoucherDepositoPDF);
    document.getElementById('btnCerrarVoucherDeposito').addEventListener('click', () => {
        document.getElementById('modalVoucherDeposito').classList.remove('active');
    });
}

/**
 * Consulta la cuenta escrita y pinta una previsualización con el titular
 * real antes de dejar depositar -- así el cajero ve a quién le está
 * acreditando el dinero, no solo un número que pudo teclear mal.
 */
async function buscarCuentaDeposito() {
    const valor = document.getElementById('dep-cuenta').value.trim();
    const preview = document.getElementById('previewCuentaDeposito');
    const btnSubmit = document.getElementById('btnDeposito');

    cuentaDepositoActual = null;
    btnSubmit.disabled = true;

    if (!valor) {
        preview.hidden = true;
        preview.className = 'cuenta-preview';
        return;
    }

    const { data, error } = await supabaseClient
        .from('cuentas')
        .select('numero_cuenta, tipo_cuenta, moneda, estado, saldo_disponible, perfiles_clientes(nombres, apellidos, dpi)')
        .eq('numero_cuenta', valor)
        .maybeSingle();

    preview.hidden = false;
    preview.innerHTML = '';

    if (error || !data) {
        preview.className = 'cuenta-preview cuenta-preview-error';
        const p = document.createElement('p');
        p.textContent = 'No se encontró ninguna cuenta con ese número. Verifica que esté completo.';
        preview.appendChild(p);
        return;
    }

    // El titular es texto libre que el propio cliente escribió al
    // registrarse: se pinta con textContent (nunca innerHTML) para que un
    // nombre con marcado ("<img onerror=...>") se muestre como texto plano
    // en vez de ejecutarse en la sesión del cajero.
    const titular = data.perfiles_clientes
        ? `${data.perfiles_clientes.nombres} ${data.perfiles_clientes.apellidos}`
        : 'Titular no disponible';

    const filas = [
        ['Titular', titular],
        ['DPI', data.perfiles_clientes?.dpi || '—'],
        ['Tipo de cuenta', `${data.tipo_cuenta} (${data.moneda})`],
        ['Estado', data.estado],
        ['Saldo actual', formatearMontoDeposito(data.saldo_disponible, data.moneda)]
    ];
    filas.forEach(([etiqueta, valorTexto]) => {
        const fila = document.createElement('div');
        fila.className = 'cuenta-preview-fila';
        const span = document.createElement('span');
        span.textContent = etiqueta + ':';
        const strong = document.createElement('strong');
        strong.textContent = valorTexto;
        fila.append(span, strong);
        preview.appendChild(fila);
    });

    if (data.estado !== 'Activa') {
        preview.className = 'cuenta-preview cuenta-preview-inactiva';
        const aviso = document.createElement('p');
        aviso.style.marginTop = '0.5rem';
        aviso.style.fontWeight = '600';
        aviso.textContent = `Esta cuenta no está activa (${data.estado}): no se puede depositar.`;
        preview.appendChild(aviso);
        return;
    }

    preview.className = 'cuenta-preview';
    cuentaDepositoActual = { ...data, titular };
    btnSubmit.disabled = false;
}

function formatearMontoDeposito(monto, moneda) {
    const simbolo = moneda === 'USD' ? '$' : 'Q';
    return `${simbolo} ${Number(monto || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function manejarSubmitDeposito(e) {
    e.preventDefault();

    const contenedorResultado = document.getElementById('resultadoDeposito');
    contenedorResultado.innerHTML = '';

    if (!cuentaDepositoActual) {
        contenedorResultado.innerHTML = `<div class="resultado-box error">Busca y confirma una cuenta válida antes de continuar.</div>`;
        return;
    }

    const monto = parseFloat(document.getElementById('dep-monto').value);
    const concepto = document.getElementById('dep-concepto').value.trim() || 'Depósito en efectivo';

    if (!monto || monto <= 0) {
        contenedorResultado.innerHTML = `<div class="resultado-box error">El monto debe ser mayor a cero.</div>`;
        return;
    }
    if (monto > MONTO_MAXIMO_DEPOSITO) {
        contenedorResultado.innerHTML = `<div class="resultado-box error">El monto máximo por depósito es Q ${MONTO_MAXIMO_DEPOSITO.toLocaleString('es-GT')}.</div>`;
        return;
    }

    const confirmado = await pedirConfirmacionDeposito({
        cuenta: cuentaDepositoActual.numero_cuenta,
        titular: cuentaDepositoActual.titular,
        montoTexto: formatearMontoDeposito(monto, cuentaDepositoActual.moneda),
        concepto
    });

    if (!confirmado) return;

    const btnConfirmar = document.getElementById('btnConfirmarDeposito');

    try {
        const { data: resultado, error } = await supabaseClient.rpc('depositar_a_cuenta', {
            p_numero_cuenta: cuentaDepositoActual.numero_cuenta,
            p_monto: monto,
            p_concepto: concepto
        });

        if (error) throw error;

        if (window.UVGMotion) window.UVGMotion.setButtonState(btnConfirmar, 'done');
        document.getElementById('modalConfirmarDeposito').classList.remove('active');

        mostrarVoucherDeposito(resultado);

        document.getElementById('form-deposito').reset();
        document.getElementById('previewCuentaDeposito').hidden = true;
        document.getElementById('btnDeposito').disabled = true;
        cuentaDepositoActual = null;
        contenedorResultado.innerHTML = '';

        // Si el dashboard de administrador está cargado, que refleje el
        // saldo total nuevo sin necesidad de recargar la página.
        if (sesionActual?.user?.app_metadata?.role === 'Administrador') {
            cargarDashboardAdmin();
        }

    } catch (err) {
        console.error('💥 Error al registrar el depósito:', err);
        if (window.UVGMotion) window.UVGMotion.setButtonState(btnConfirmar, null);
        document.getElementById('modalConfirmarDeposito').classList.remove('active');
        contenedorResultado.innerHTML = `
            <div class="resultado-box error">
                <strong>No se pudo aplicar el depósito</strong>
                ${err.message || 'Ocurrió un error inesperado.'}
            </div>
        `;
    }
}

/**
 * Modal de confirmación previa (mismo patrón que usa transferencias.js del
 * lado del cliente): devuelve una Promise que resuelve true/false, para
 * poder usarse con await igual que un confirm() nativo.
 */
function pedirConfirmacionDeposito(datos) {
    return new Promise((resolve) => {
        const modal = document.getElementById('modalConfirmarDeposito');
        const btnConfirmar = document.getElementById('btnConfirmarDeposito');
        const btnCancelar = document.getElementById('btnCancelarDeposito');

        // Texto controlado por el propio banco o dígitos ya validados: no
        // hay dato libre de cliente acá salvo el titular, que también se
        // pinta con textContent.
        document.getElementById('confDepCuenta').textContent = datos.cuenta;
        document.getElementById('confDepTitular').textContent = datos.titular;
        document.getElementById('confDepMonto').textContent = datos.montoTexto;
        document.getElementById('confDepConcepto').textContent = datos.concepto;

        if (window.UVGMotion) window.UVGMotion.setButtonState(btnConfirmar, null);
        btnCancelar.disabled = false;

        function finalizar(resultado) {
            modal.classList.remove('active');
            btnConfirmar.removeEventListener('click', onConfirmar);
            btnCancelar.removeEventListener('click', onCancelar);
            resolve(resultado);
        }
        function onConfirmar() {
            // El modal se queda abierto (con el botón en "loading") mientras
            // corre la llamada real a la RPC; quien la llama es quien lo
            // cierra al terminar, sea con éxito o con error.
            btnConfirmar.removeEventListener('click', onConfirmar);
            btnCancelar.removeEventListener('click', onCancelar);
            btnCancelar.disabled = true;
            if (window.UVGMotion) window.UVGMotion.setButtonState(btnConfirmar, 'loading');
            resolve(true);
        }
        function onCancelar() { finalizar(false); }

        btnConfirmar.addEventListener('click', onConfirmar);
        btnCancelar.addEventListener('click', onCancelar);

        modal.classList.add('active');
    });
}

function mostrarVoucherDeposito(datos) {
    const fecha = new Date(datos.fecha).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'medium' });
    const simbolo = datos.moneda === 'USD' ? '$' : 'Q';
    const fmt = (n) => Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    document.getElementById('vchMonto').textContent = `${simbolo} ${fmt(datos.monto)}`;
    document.getElementById('vchAutorizacion').textContent = datos.codigo_autorizacion;
    document.getElementById('vchFecha').textContent = fecha;
    document.getElementById('vchCuenta').textContent = datos.numero_cuenta;
    document.getElementById('vchTipoCuenta').textContent = `${datos.tipo_cuenta} (${datos.moneda})`;
    document.getElementById('vchTitular').textContent = datos.titular; // texto de la RPC, vía textContent igual que el resto
    document.getElementById('vchConcepto').textContent = datos.concepto;
    document.getElementById('vchSaldoAnterior').textContent = `${simbolo} ${fmt(datos.saldo_anterior)}`;
    document.getElementById('vchSaldoNuevo').textContent = `${simbolo} ${fmt(datos.saldo_nuevo)}`;
    document.getElementById('vchAtendidoPor').textContent = datos.atendido_por;

    document.getElementById('modalVoucherDeposito').classList.add('active');
}

function descargarVoucherDepositoPDF() {
    const elemento = document.getElementById('areaVoucherDepositoPDF');
    const referencia = document.getElementById('vchAutorizacion').textContent || 'voucher';

    if (typeof html2pdf === 'undefined') {
        alert('No se pudo cargar el generador de PDF. Revisa tu conexión e inténtalo de nuevo.');
        return;
    }

    html2pdf().set({
        margin: 0.5,
        filename: `${referencia}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
    }).from(elemento).save();
}
