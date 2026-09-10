// INTERFAZ COMPARTIDA DEL CLIENTE
//
// Dos piezas que van en TODAS las páginas del dashboard, así que viven acá en
// vez de repetirse ocho veces en el HTML:
//
//   1. Barra lateral desplegable: un botón la colapsa a solo iconos y la
//      vuelve a abrir. En pantallas chicas se abre como cajón encima del
//      contenido. La preferencia se recuerda entre páginas y recargas.
//
//   2. Vista de perfil: el icono de persona del header abre un modal con los
//      datos reales del cliente (perfil, cuentas y tarjetas) en vez de
//      mandarlo a otra página.
//
// El markup del modal y del botón se inyecta desde acá a propósito: son la
// misma cosa en las 8 páginas, y duplicarlo garantizaría que con el tiempo
// unas queden distintas a otras.

const ANCHO_MOVIL = 768;
const LLAVE_SIDEBAR = 'uvg-sidebar-colapsado';

let supabaseClientInterfaz = null;
let idUsuarioInterfaz = null;
let perfilCacheado = null;

document.addEventListener('DOMContentLoaded', () => {
    inicializarSidebar();
    inicializarPerfil();
});

// ==========================================================
// 1. BARRA LATERAL DESPLEGABLE
// ==========================================================
function inicializarSidebar() {
    const layout = document.querySelector('.dashboard-layout');
    const header = document.querySelector('.banca-header');
    if (!layout || !header) return;

    const boton = document.createElement('button');
    boton.type = 'button';
    boton.id = 'btnToggleSidebar';
    boton.className = 'btn-toggle-sidebar';
    boton.setAttribute('aria-label', 'Mostrar u ocultar el menú lateral');
    boton.setAttribute('aria-expanded', 'true');
    boton.innerHTML = '<i class="ri-menu-line"></i>';
    header.insertBefore(boton, header.firstChild);

    // Fondo oscuro para el modo cajón en pantallas chicas: al tocarlo se
    // cierra, que es lo que espera cualquiera en un celular.
    const scrim = document.createElement('div');
    scrim.className = 'scrim-sidebar';
    scrim.hidden = true;
    layout.appendChild(scrim);

    const esMovil = () => window.innerWidth <= ANCHO_MOVIL;

    const sincronizar = () => {
        const colapsado = layout.classList.contains('sidebar-colapsado');
        const abierto = layout.classList.contains('sidebar-abierto');
        // En escritorio "expandido" es lo normal; en móvil lo normal es
        // colapsado y el botón lo que hace es abrir el cajón.
        boton.setAttribute('aria-expanded', String(esMovil() ? abierto : !colapsado));
        scrim.hidden = !abierto;

        // Con la barra en modo icono, el texto del enlace ya no se ve: el
        // title es lo único que dice a dónde lleva cada icono.
        const soloIconos = esMovil() ? !abierto : colapsado;
        document.querySelectorAll('.sidebar-menu a').forEach(a => {
            const etiqueta = a.querySelector('span')?.textContent.trim();
            if (!etiqueta) return;
            if (soloIconos) {
                a.setAttribute('title', etiqueta);
            } else {
                a.removeAttribute('title');
            }
        });
    };

    // Se restaura la preferencia guardada. localStorage puede tronar (ventana
    // privada, cookies bloqueadas), así que nunca sin try.
    try {
        if (localStorage.getItem(LLAVE_SIDEBAR) === '1') {
            layout.classList.add('sidebar-colapsado');
        }
    } catch (err) {
        // Sin preferencia guardada: se queda como viene por defecto.
    }

    boton.addEventListener('click', () => {
        if (esMovil()) {
            layout.classList.toggle('sidebar-abierto');
        } else {
            const colapsado = layout.classList.toggle('sidebar-colapsado');
            try {
                localStorage.setItem(LLAVE_SIDEBAR, colapsado ? '1' : '0');
            } catch (err) {
                // Si no se puede guardar, el toggle igual funciona en esta página.
            }
        }
        sincronizar();
    });

    scrim.addEventListener('click', () => {
        layout.classList.remove('sidebar-abierto');
        sincronizar();
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && layout.classList.contains('sidebar-abierto')) {
            layout.classList.remove('sidebar-abierto');
            sincronizar();
        }
    });

    // Al pasar de móvil a escritorio (o al rotar) el cajón deja de tener
    // sentido: se cierra para no quedar con la barra flotando encima.
    window.addEventListener('resize', () => {
        if (!esMovil()) layout.classList.remove('sidebar-abierto');
        sincronizar();
    });

    sincronizar();
}

// ==========================================================
// 2. VISTA DE PERFIL
// ==========================================================
function inicializarPerfil() {
    const disparadores = document.querySelectorAll('a.user-profile-badge');
    if (disparadores.length === 0) return;

    inyectarModalPerfil();

    disparadores.forEach(disparador => {
        disparador.setAttribute('role', 'button');
        disparador.setAttribute('title', 'Ver mi perfil');
        disparador.addEventListener('click', async e => {
            e.preventDefault(); // ya no navega a gestiones.html
            abrirModalPerfil();
            await cargarDatosPerfil();
        });
    });
}

function inyectarModalPerfil() {
    if (document.getElementById('modalPerfil')) return;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'modalPerfil';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
        <div class="modal-container modal-perfil" role="dialog" aria-labelledby="tituloModalPerfil">
            <header class="modal-header">
                <div class="modal-title-group">
                    <div class="avatar-perfil" id="perfilIniciales">··</div>
                    <div>
                        <h2 id="tituloModalPerfil">Mi perfil</h2>
                        <p id="perfilCorreo">Cargando tus datos...</p>
                    </div>
                </div>
                <button type="button" class="btn-close-modal" id="btnCerrarPerfil" title="Cerrar">
                    <i class="ri-close-line"></i>
                </button>
            </header>

            <div class="modal-body">
                <section class="bloque-perfil">
                    <h3><i class="ri-id-card-line"></i> Datos personales</h3>
                    <div class="comprobante-detalles">
                        <div class="detalle-fila"><span>Nombre completo:</span><strong id="perfilNombre">—</strong></div>
                        <div class="detalle-fila"><span>DPI:</span><strong id="perfilDpi">—</strong></div>
                        <div class="detalle-fila"><span>Teléfono:</span><strong id="perfilTelefono">—</strong></div>
                        <div class="detalle-fila"><span>Dirección:</span><strong id="perfilDireccion">—</strong></div>
                        <div class="detalle-fila"><span>Fecha de nacimiento:</span><strong id="perfilNacimiento">—</strong></div>
                        <div class="detalle-fila"><span>Cliente desde:</span><strong id="perfilDesde">—</strong></div>
                    </div>
                </section>

                <section class="bloque-perfil">
                    <h3><i class="ri-wallet-3-line"></i> Mis cuentas</h3>
                    <div id="perfilCuentas" class="lista-perfil">
                        <p class="section-desc">Cargando...</p>
                    </div>
                </section>

                <section class="bloque-perfil">
                    <h3><i class="ri-bank-card-line"></i> Mis tarjetas</h3>
                    <div id="perfilTarjetas" class="lista-perfil">
                        <p class="section-desc">Cargando...</p>
                    </div>
                </section>

                <p class="nota-gestion">
                    <i class="ri-information-line"></i>
                    Para cambiar tu teléfono o dirección usa <strong>Gestiones y Seguridad</strong>.
                    Tu nombre y DPI solo los puede corregir un asesor en agencia.
                </p>

                <footer class="modal-footer">
                    <button type="button" class="btn-modal-secondary" id="btnCerrarPerfilPie">Cerrar</button>
                    <a href="gestiones.html" class="btn-modal-primary">
                        <i class="ri-settings-4-line"></i> Gestiones y Seguridad
                    </a>
                </footer>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('btnCerrarPerfil').addEventListener('click', cerrarModalPerfil);
    document.getElementById('btnCerrarPerfilPie').addEventListener('click', cerrarModalPerfil);
    modal.addEventListener('click', e => { if (e.target === modal) cerrarModalPerfil(); });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && modal.classList.contains('active')) cerrarModalPerfil();
    });
}

function abrirModalPerfil() {
    const modal = document.getElementById('modalPerfil');
    if (!modal) return;
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    document.getElementById('btnCerrarPerfil')?.focus();
}

function cerrarModalPerfil() {
    const modal = document.getElementById('modalPerfil');
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

async function cargarDatosPerfil() {
    // Ya se cargó una vez en esta página: no se vuelve a pegar a la red.
    if (perfilCacheado) return;

    if (!supabaseClientInterfaz) {
        if (typeof CONFIG === 'undefined' || !window.supabase) return;
        supabaseClientInterfaz = window.supabase.createClient(CONFIG.URL_DE_SUPABASE, CONFIG.KEY_ANON_SUPABASE);
    }

    const { data: sesion } = await supabaseClientInterfaz.auth.getSession();
    if (!sesion?.session) return; // sesion_comun.js ya se encarga de redirigir

    document.getElementById('perfilCorreo').textContent = sesion.session.user.email || '—';

    if (!idUsuarioInterfaz) {
        const { data: fila } = await supabaseClientInterfaz
            .from('usuarios')
            .select('id_usuario, fecha_creacion')
            .eq('auth_uid', sesion.session.user.id)
            .maybeSingle();
        if (!fila) return;
        idUsuarioInterfaz = fila.id_usuario;
        document.getElementById('perfilDesde').textContent = formatearFechaCorta(fila.fecha_creacion);
    }

    const { data: perfil, error } = await supabaseClientInterfaz
        .from('perfiles_clientes')
        .select('dpi, nombres, apellidos, telefono, direccion, fecha_nacimiento, fecha_registro')
        .eq('id_usuario', idUsuarioInterfaz)
        .maybeSingle();

    if (error || !perfil) {
        console.error('💥 No se pudo cargar el perfil:', error);
        document.getElementById('perfilCuentas').innerHTML =
            '<p class="section-desc">No se pudieron cargar tus datos.</p>';
        return;
    }

    perfilCacheado = perfil;

    const nombreCompleto = `${perfil.nombres} ${perfil.apellidos}`;
    document.getElementById('perfilNombre').textContent = nombreCompleto;
    document.getElementById('perfilDpi').textContent = perfil.dpi;
    document.getElementById('perfilTelefono').textContent = perfil.telefono || '—';
    document.getElementById('perfilDireccion').textContent = perfil.direccion || '—';
    document.getElementById('perfilNacimiento').textContent = formatearFechaCorta(perfil.fecha_nacimiento);
    document.getElementById('perfilIniciales').textContent = iniciales(perfil.nombres, perfil.apellidos);

    await Promise.all([
        pintarCuentasPerfil(perfil.dpi),
        pintarTarjetasPerfil()
    ]);
}

async function pintarCuentasPerfil(dpi) {
    const contenedor = document.getElementById('perfilCuentas');

    const { data, error } = await supabaseClientInterfaz
        .from('cuentas')
        .select('numero_cuenta, tipo_cuenta, moneda, estado, saldo_disponible')
        .eq('dpi_cliente', dpi)
        .order('tipo_cuenta');

    if (error) {
        contenedor.innerHTML = '<p class="section-desc">No se pudieron cargar tus cuentas.</p>';
        return;
    }
    if (!data || data.length === 0) {
        contenedor.innerHTML = '<p class="section-desc">Todavía no tienes cuentas abiertas.</p>';
        return;
    }

    contenedor.innerHTML = '';
    data.forEach(c => {
        const fila = document.createElement('div');
        fila.className = 'fila-perfil';

        const izq = document.createElement('div');
        const titulo = document.createElement('strong');
        titulo.textContent = `Cuenta ${c.tipo_cuenta}`;
        const numero = document.createElement('small');
        numero.textContent = `No. ${c.numero_cuenta} · ${c.moneda}`;
        izq.append(titulo, document.createElement('br'), numero);

        const der = document.createElement('div');
        der.className = 'fila-perfil-valor';
        const saldo = document.createElement('strong');
        saldo.textContent = formatearQuetzales(c.saldo_disponible, c.moneda);
        const estado = document.createElement('span');
        estado.className = 'badge-estado estado-' + (c.estado || '').toLowerCase();
        estado.textContent = c.estado;
        der.append(saldo, document.createElement('br'), estado);

        fila.append(izq, der);
        contenedor.appendChild(fila);
    });
}

async function pintarTarjetasPerfil() {
    const contenedor = document.getElementById('perfilTarjetas');

    // La RLS de tarjetas ya limita el resultado a las del dueño de la sesión.
    const { data, error } = await supabaseClientInterfaz
        .from('tarjetas')
        .select('pan_enmascarado, estado_tarjeta, fecha_vencimiento, numero_cuenta, motivo_bloqueo')
        .order('fecha_emision', { ascending: false });

    if (error) {
        contenedor.innerHTML = '<p class="section-desc">No se pudieron cargar tus tarjetas.</p>';
        return;
    }
    if (!data || data.length === 0) {
        contenedor.innerHTML = '<p class="section-desc">Todavía no tienes tarjetas emitidas.</p>';
        return;
    }

    contenedor.innerHTML = '';
    data.forEach(t => {
        const fila = document.createElement('div');
        fila.className = 'fila-perfil';

        const izq = document.createElement('div');
        const titulo = document.createElement('strong');
        titulo.textContent = t.pan_enmascarado;
        const detalle = document.createElement('small');
        detalle.textContent = `Vence ${formatearVencimiento(t.fecha_vencimiento)} · cuenta ${t.numero_cuenta}`;
        izq.append(titulo, document.createElement('br'), detalle);

        const der = document.createElement('div');
        der.className = 'fila-perfil-valor';
        const estado = document.createElement('span');
        estado.className = 'badge-estado estado-' + (t.estado_tarjeta || '').toLowerCase();
        estado.textContent = t.estado_tarjeta;
        der.appendChild(estado);
        if (t.motivo_bloqueo) {
            const motivo = document.createElement('small');
            motivo.textContent = t.motivo_bloqueo;
            der.append(document.createElement('br'), motivo);
        }

        fila.append(izq, der);
        contenedor.appendChild(fila);
    });
}

// ==========================================================
// AYUDANTES
// ==========================================================
function iniciales(nombres, apellidos) {
    const a = (nombres || '').trim()[0] || '';
    const b = (apellidos || '').trim()[0] || '';
    return (a + b).toUpperCase() || '··';
}

function formatearFechaCorta(iso) {
    if (!iso) return '—';
    // Las fechas tipo DATE llegan como 'YYYY-MM-DD'; se parten a mano para
    // que el navegador no las corra un día por interpretarlas en UTC.
    const soloFecha = /^\d{4}-\d{2}-\d{2}$/.exec(iso);
    const fecha = soloFecha
        ? new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
        : new Date(iso);
    return fecha.toLocaleDateString('es-GT', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatearVencimiento(iso) {
    if (!iso) return '—';
    return `${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
}

function formatearQuetzales(monto, moneda) {
    const simbolo = moneda === 'USD' ? '$' : 'Q';
    return `${simbolo} ${Number(monto || 0).toLocaleString('es-GT', {
        minimumFractionDigits: 2, maximumFractionDigits: 2
    })}`;
}
