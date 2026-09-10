// CONTROLADOR: GESTIONES Y SEGURIDAD
//
// Las 5 tarjetas de esta página eran botones sin backend. Cada una abre ahora
// un modal real contra la base de datos:
//   1. Reiniciar PIN      -> RPC reiniciar_pin_tarjeta (bcrypt, nunca en claro)
//   2. Cambiar contraseña -> Supabase Auth (re-autentica antes de cambiar)
//   3. Bloquear tarjeta   -> RPC bloquear_tarjeta_propia (+ reposición opcional)
//   4. Actualizar datos   -> RPC actualizar_datos_contacto
//   5. Solicitar chequera -> INSERT en solicitudes_productos (llega al cajero)

let supabaseClientGestiones = null;
let idUsuarioGestiones = null;
let tarjetasDelCliente = [];
let cuentasDelCliente = [];
let perfilDelCliente = null;
let correoDelCliente = '';

/** Qué modal abre cada tarjeta de la grilla, en el orden en que aparecen. */
const GESTIONES = [
    { boton: 'btnGestionPin', modal: 'modalPin', preparar: prepararModalPin },
    { boton: 'btnGestionClave', modal: 'modalClave', preparar: prepararModalClave },
    { boton: 'btnGestionBloqueo', modal: 'modalBloqueo', preparar: prepararModalBloqueo },
    { boton: 'btnGestionDatos', modal: 'modalDatos', preparar: prepararModalDatos },
    { boton: 'btnGestionChequera', modal: 'modalChequera', preparar: prepararModalChequera }
];

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof CONFIG !== 'undefined' && CONFIG.URL_DE_SUPABASE && CONFIG.KEY_ANON_SUPABASE && window.supabase) {
        supabaseClientGestiones = window.supabase.createClient(CONFIG.URL_DE_SUPABASE, CONFIG.KEY_ANON_SUPABASE);
    }

    if (!supabaseClientGestiones) {
        console.error('💥 No se pudo inicializar el cliente de Supabase. Revisa config.example.js.');
        return;
    }

    idUsuarioGestiones = await resolverSesionCliente(supabaseClientGestiones);
    if (!idUsuarioGestiones) return; // resolverSesionCliente ya redirigió a login

    const { data: sesion } = await supabaseClientGestiones.auth.getSession();
    correoDelCliente = sesion?.session?.user?.email || '';

    await Promise.all([
        cargarPerfilYCuentas(),
        cargarTarjetas(),
        cargarHistorialGestiones()
    ]);

    // Abrir / cerrar cada modal
    GESTIONES.forEach(({ boton, modal, preparar }) => {
        const btn = document.getElementById(boton);
        if (!btn) return;
        btn.addEventListener('click', () => {
            preparar();
            abrirModalGestion(modal);
        });
    });

    document.querySelectorAll('[data-cerrar-modal]').forEach(btn => {
        btn.addEventListener('click', () => cerrarModalGestion(btn.dataset.cerrarModal));
    });

    // Clic en el fondo oscuro y tecla Escape también cierran.
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) cerrarModalGestion(overlay.id);
        });
    });
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        const abierto = document.querySelector('.modal-overlay.active');
        if (abierto) cerrarModalGestion(abierto.id);
    });

    // Formularios
    document.getElementById('formPin')?.addEventListener('submit', manejarSubmitPin);
    document.getElementById('formClave')?.addEventListener('submit', manejarSubmitClave);
    document.getElementById('formBloqueo')?.addEventListener('submit', manejarSubmitBloqueo);
    document.getElementById('formDatos')?.addEventListener('submit', manejarSubmitDatos);
    document.getElementById('formChequera')?.addEventListener('submit', manejarSubmitChequera);

    inicializarFiltrosDeEscritura();
});

// ==========================================
// CARGA DE DATOS
// ==========================================
async function cargarPerfilYCuentas() {
    const { data: perfil, error: errPerfil } = await supabaseClientGestiones
        .from('perfiles_clientes')
        .select('dpi, nombres, apellidos, telefono, direccion')
        .eq('id_usuario', idUsuarioGestiones)
        .maybeSingle();

    if (errPerfil) {
        console.error('💥 Error al cargar el perfil:', errPerfil);
        return;
    }
    perfilDelCliente = perfil;
    if (!perfil) return;

    const { data: cuentas, error: errCuentas } = await supabaseClientGestiones
        .from('cuentas')
        .select('numero_cuenta, tipo_cuenta, moneda, estado')
        .eq('dpi_cliente', perfil.dpi)
        .order('tipo_cuenta');

    if (errCuentas) {
        console.error('💥 Error al cargar las cuentas:', errCuentas);
        return;
    }
    cuentasDelCliente = cuentas || [];
}

async function cargarTarjetas() {
    // La RLS ya limita el resultado a las tarjetas del dueño de la sesión:
    // no hace falta (ni serviría) filtrar por cuenta desde el navegador.
    const { data, error } = await supabaseClientGestiones
        .from('tarjetas')
        .select('id_tarjeta, pan_enmascarado, estado_tarjeta, numero_cuenta, fecha_vencimiento, pin_actualizado_en, motivo_bloqueo')
        .order('fecha_emision', { ascending: false });

    if (error) {
        console.error('💥 Error al cargar las tarjetas:', error);
        return;
    }
    tarjetasDelCliente = data || [];
}

/** Historial de gestiones que pasan por el cajero, con su estado real. */
async function cargarHistorialGestiones() {
    const contenedor = document.getElementById('listaHistorialGestiones');
    if (!contenedor) return;

    const { data, error } = await supabaseClientGestiones
        .from('solicitudes_productos')
        .select('nombre_producto_solicitado, estado, fecha_solicitud, dato_adicional_etiqueta, dato_adicional_valor')
        .eq('id_usuario', idUsuarioGestiones)
        .order('fecha_solicitud', { ascending: false })
        .limit(10);

    if (error) {
        console.error('💥 Error al cargar el historial de gestiones:', error);
        contenedor.innerHTML = '<p class="section-desc">No se pudo cargar tu historial.</p>';
        return;
    }

    if (!data || data.length === 0) {
        contenedor.innerHTML = '<p class="section-desc">Todavía no has hecho ninguna gestión que requiera revisión.</p>';
        return;
    }

    // Se arma con nodos de DOM y textContent, no con innerHTML interpolado: el
    // texto viene de filas de solicitudes que podrían traer marcado.
    contenedor.innerHTML = '';
    data.forEach(s => {
        const fila = document.createElement('div');
        fila.className = 'fila-historial-gestion';

        const info = document.createElement('div');
        const titulo = document.createElement('strong');
        titulo.textContent = s.nombre_producto_solicitado;
        info.appendChild(titulo);

        if (s.dato_adicional_etiqueta && s.dato_adicional_valor) {
            const detalle = document.createElement('small');
            detalle.textContent = `${s.dato_adicional_etiqueta}: ${s.dato_adicional_valor}`;
            info.append(document.createElement('br'), detalle);
        }

        const fecha = document.createElement('small');
        fecha.className = 'texto-tenue';
        fecha.textContent = formatearFecha(s.fecha_solicitud);
        info.append(document.createElement('br'), fecha);

        const estado = document.createElement('span');
        estado.className = 'badge-estado estado-' + (s.estado || '').toLowerCase();
        estado.textContent = s.estado;

        fila.append(info, estado);
        contenedor.appendChild(fila);
    });
}

// ==========================================
// APERTURA / CIERRE DE MODALES
// ==========================================
function abrirModalGestion(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    modal.querySelector('input:not([type=hidden]), select')?.focus();
}

function cerrarModalGestion(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';

    // Se limpia el formulario para no dejar contraseñas ni PINes escritos en
    // el DOM después de cerrar.
    const form = modal.querySelector('form');
    if (form) {
        form.reset();
        form.querySelectorAll('input[type=password], input[data-pin]').forEach(i => { i.value = ''; });
    }
    modal.querySelectorAll('.resultado-gestion').forEach(box => {
        box.textContent = '';
        box.className = 'resultado-gestion';
        box.hidden = true;
    });
}

function mostrarResultadoGestion(idModal, mensaje, esError) {
    const box = document.querySelector(`#${idModal} .resultado-gestion`);
    if (!box) return;
    box.textContent = mensaje;
    box.className = 'resultado-gestion ' + (esError ? 'error' : 'exito');
    box.hidden = false;
}

// ==========================================
// 1. REINICIAR PIN DE TARJETA
// ==========================================
function prepararModalPin() {
    const select = document.getElementById('pinTarjeta');
    if (!select) return;

    const activas = tarjetasDelCliente.filter(t => t.estado_tarjeta === 'Activa');
    pintarOpcionesTarjeta(select, activas, 'No tienes tarjetas activas');

    const btn = document.querySelector('#formPin button[type=submit]');
    if (btn) btn.disabled = activas.length === 0;
}

async function manejarSubmitPin(e) {
    e.preventDefault();
    const boton = e.submitter || document.querySelector('#formPin button[type=submit]');

    const idTarjeta = document.getElementById('pinTarjeta').value;
    const pin = document.getElementById('pinNuevo').value;
    const pinConfirma = document.getElementById('pinConfirma').value;

    if (!idTarjeta) return mostrarResultadoGestion('modalPin', 'Elige una tarjeta.', true);
    if (!/^\d{4}$/.test(pin)) return mostrarResultadoGestion('modalPin', 'El PIN debe ser exactamente 4 dígitos.', true);
    if (pin !== pinConfirma) return mostrarResultadoGestion('modalPin', 'Los dos PIN no coinciden.', true);

    // Las mismas reglas las revalida la RPC en el servidor; acá es solo para
    // avisar al instante y no gastar un viaje a la red.
    if (/^(\d)\1{3}$/.test(pin)) return mostrarResultadoGestion('modalPin', 'El PIN no puede tener los 4 dígitos iguales.', true);
    if ('0123456789'.includes(pin) || '9876543210'.includes(pin)) {
        return mostrarResultadoGestion('modalPin', 'El PIN no puede ser una secuencia consecutiva (1234, 4321...).', true);
    }

    window.UVGMotion?.setButtonState(boton, 'loading');

    const { data, error } = await supabaseClientGestiones.rpc('reiniciar_pin_tarjeta', {
        p_id_tarjeta: idTarjeta,
        p_pin: pin
    });

    if (error) {
        window.UVGMotion?.setButtonState(boton, null);
        return mostrarResultadoGestion('modalPin', traducirError(error), true);
    }

    window.UVGMotion?.setButtonState(boton, 'done');
    mostrarResultadoGestion('modalPin', `PIN actualizado para la tarjeta ${data.tarjeta}. Ya puedes usarlo en cualquier cajero.`, false);
    document.getElementById('pinNuevo').value = '';
    document.getElementById('pinConfirma').value = '';
    await cargarTarjetas();
    setTimeout(() => window.UVGMotion?.setButtonState(boton, null), 2000);
}

// ==========================================
// 2. CAMBIAR CONTRASEÑA DE BANCA
// ==========================================
function prepararModalClave() {
    const el = document.getElementById('claveCorreo');
    if (el) el.textContent = correoDelCliente || '—';
}

async function manejarSubmitClave(e) {
    e.preventDefault();
    const boton = e.submitter || document.querySelector('#formClave button[type=submit]');

    const actual = document.getElementById('claveActual').value;
    const nueva = document.getElementById('claveNueva').value;
    const confirma = document.getElementById('claveConfirma').value;

    if (nueva !== confirma) return mostrarResultadoGestion('modalClave', 'La contraseña nueva y su confirmación no coinciden.', true);

    const problema = validarFuerzaClave(nueva);
    if (problema) return mostrarResultadoGestion('modalClave', problema, true);
    if (nueva === actual) return mostrarResultadoGestion('modalClave', 'La contraseña nueva debe ser distinta a la actual.', true);

    window.UVGMotion?.setButtonState(boton, 'loading');

    // Primero se re-autentica con la contraseña actual: sin esto, cualquiera
    // que agarre la sesión abierta podría cambiar la clave sin conocerla.
    const { error: errorLogin } = await supabaseClientGestiones.auth.signInWithPassword({
        email: correoDelCliente,
        password: actual
    });

    if (errorLogin) {
        window.UVGMotion?.setButtonState(boton, null);
        return mostrarResultadoGestion('modalClave', 'La contraseña actual no es correcta.', true);
    }

    const { error } = await supabaseClientGestiones.auth.updateUser({ password: nueva });

    if (error) {
        window.UVGMotion?.setButtonState(boton, null);
        return mostrarResultadoGestion('modalClave', traducirError(error), true);
    }

    window.UVGMotion?.setButtonState(boton, 'done');
    mostrarResultadoGestion('modalClave', 'Contraseña actualizada. Por seguridad vamos a cerrar tu sesión para que entres con la nueva.', false);

    setTimeout(async () => {
        await supabaseClientGestiones.auth.signOut();
        window.location.href = 'Login_personal.html';
    }, 2600);
}

/** Reglas mínimas de una clave de banca. Devuelve null si está bien. */
function validarFuerzaClave(clave) {
    if (!clave || clave.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
    if (!/[A-Za-z]/.test(clave)) return 'La contraseña debe incluir al menos una letra.';
    if (!/[0-9]/.test(clave)) return 'La contraseña debe incluir al menos un número.';
    if (/^\s|\s$/.test(clave)) return 'La contraseña no puede empezar ni terminar con espacios.';
    return null;
}

// ==========================================
// 3. BLOQUEO PREVENTIVO DE TARJETA
// ==========================================
function prepararModalBloqueo() {
    const select = document.getElementById('bloqueoTarjeta');
    if (!select) return;

    const bloqueables = tarjetasDelCliente.filter(t => t.estado_tarjeta !== 'Bloqueada');
    pintarOpcionesTarjeta(select, bloqueables, 'No tienes tarjetas que se puedan bloquear');

    const btn = document.querySelector('#formBloqueo button[type=submit]');
    if (btn) btn.disabled = bloqueables.length === 0;

    // Se listan las que ya están bloqueadas para que el cliente no se
    // pregunte dónde quedaron.
    const aviso = document.getElementById('bloqueoYaBloqueadas');
    if (aviso) {
        const yaBloqueadas = tarjetasDelCliente.filter(t => t.estado_tarjeta === 'Bloqueada');
        if (yaBloqueadas.length === 0) {
            aviso.hidden = true;
        } else {
            aviso.hidden = false;
            aviso.textContent = 'Ya bloqueadas: ' +
                yaBloqueadas.map(t => `${t.pan_enmascarado} (${t.motivo_bloqueo || 'sin motivo'})`).join(', ') +
                '. Para reactivarlas tienes que ir a una agencia.';
        }
    }
}

async function manejarSubmitBloqueo(e) {
    e.preventDefault();
    const boton = e.submitter || document.querySelector('#formBloqueo button[type=submit]');

    const idTarjeta = document.getElementById('bloqueoTarjeta').value;
    const motivo = document.getElementById('bloqueoMotivo').value;
    const pideReposicion = document.getElementById('bloqueoReposicion').checked;

    if (!idTarjeta) return mostrarResultadoGestion('modalBloqueo', 'Elige la tarjeta que quieres bloquear.', true);
    if (!document.getElementById('bloqueoConfirmo').checked) {
        return mostrarResultadoGestion('modalBloqueo', 'Debes confirmar que entiendes que el bloqueo es inmediato.', true);
    }

    window.UVGMotion?.setButtonState(boton, 'loading');

    const tarjeta = tarjetasDelCliente.find(t => t.id_tarjeta === idTarjeta);

    const { data, error } = await supabaseClientGestiones.rpc('bloquear_tarjeta_propia', {
        p_id_tarjeta: idTarjeta,
        p_motivo: motivo
    });

    if (error) {
        window.UVGMotion?.setButtonState(boton, null);
        return mostrarResultadoGestion('modalBloqueo', traducirError(error), true);
    }

    let mensaje = `Tarjeta ${data.tarjeta} bloqueada por "${data.motivo}". Ya no se puede usar para compras ni en cajeros.`;

    // La reposición es una solicitud aparte: le llega al cajero como
    // notificación pendiente igual que cualquier otro producto.
    if (pideReposicion) {
        const { error: errorRepo } = await supabaseClientGestiones
            .from('solicitudes_productos')
            .insert({
                id_usuario: idUsuarioGestiones,
                dpi_cliente: perfilDelCliente?.dpi || null,
                nombre_producto_solicitado: 'Reposición de tarjeta',
                telefono_contacto: perfilDelCliente?.telefono || null,
                direccion_entrega: perfilDelCliente?.direccion || null,
                dato_adicional_etiqueta: 'Tarjeta bloqueada',
                dato_adicional_valor: `${tarjeta?.pan_enmascarado || ''} — ${motivo}`
            });

        mensaje += errorRepo
            ? ' El bloqueo sí quedó aplicado, pero no se pudo registrar la solicitud de reposición.'
            : ' Tu solicitud de reposición quedó registrada y un asesor la revisará.';
        if (errorRepo) console.error('💥 Error al pedir reposición:', errorRepo);
    }

    window.UVGMotion?.setButtonState(boton, 'done');
    mostrarResultadoGestion('modalBloqueo', mensaje, false);
    await Promise.all([cargarTarjetas(), cargarHistorialGestiones()]);
    prepararModalBloqueo();
    setTimeout(() => window.UVGMotion?.setButtonState(boton, null), 2000);
}

// ==========================================
// 4. ACTUALIZACIÓN DE DATOS / RTU
// ==========================================
function prepararModalDatos() {
    if (!perfilDelCliente) return;

    document.getElementById('datosNombre').value =
        `${perfilDelCliente.nombres} ${perfilDelCliente.apellidos}`;
    document.getElementById('datosDpi').value = perfilDelCliente.dpi;
    document.getElementById('datosCorreo').value = correoDelCliente;

    // El +502 es fijo en el prefijo del campo, igual que en el registro que
    // hace el cajero, así que en el input solo van los 8 dígitos.
    const tel = (perfilDelCliente.telefono || '').replace(/^\+502/, '');
    document.getElementById('datosTelefono').value = tel;
    document.getElementById('datosDireccion').value = perfilDelCliente.direccion || '';
}

async function manejarSubmitDatos(e) {
    e.preventDefault();
    const boton = e.submitter || document.querySelector('#formDatos button[type=submit]');

    const telefono = document.getElementById('datosTelefono').value.trim();
    const direccion = document.getElementById('datosDireccion').value.trim();

    if (!/^\d{8}$/.test(telefono)) {
        return mostrarResultadoGestion('modalDatos', 'El teléfono debe tener exactamente 8 dígitos.', true);
    }
    if (direccion.length < 10) {
        return mostrarResultadoGestion('modalDatos', 'Escribe una dirección más completa (mínimo 10 caracteres).', true);
    }

    window.UVGMotion?.setButtonState(boton, 'loading');

    const { data, error } = await supabaseClientGestiones.rpc('actualizar_datos_contacto', {
        p_telefono: '+502' + telefono,
        p_direccion: direccion
    });

    if (error) {
        window.UVGMotion?.setButtonState(boton, null);
        return mostrarResultadoGestion('modalDatos', traducirError(error), true);
    }

    // Se refresca la copia local para que el resto de la página (y la próxima
    // apertura del modal) muestre lo nuevo sin recargar.
    perfilDelCliente.telefono = data.telefono;
    perfilDelCliente.direccion = data.direccion;

    window.UVGMotion?.setButtonState(boton, 'done');
    mostrarResultadoGestion('modalDatos', 'Tus datos de contacto quedaron actualizados.', false);
    setTimeout(() => window.UVGMotion?.setButtonState(boton, null), 2000);
}

// ==========================================
// 5. SOLICITAR CHEQUERA
// ==========================================
function prepararModalChequera() {
    const select = document.getElementById('chequeraCuenta');
    if (!select) return;

    // Las chequeras son solo para cuenta monetaria: una cuenta de ahorro no
    // gira cheques.
    const monetarias = cuentasDelCliente.filter(c => c.tipo_cuenta === 'Monetaria' && c.estado === 'Activa');

    select.innerHTML = '';
    if (monetarias.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No tienes una cuenta monetaria activa';
        select.appendChild(opt);
    } else {
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Selecciona la cuenta';
        select.appendChild(placeholder);
        monetarias.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.numero_cuenta;
            opt.textContent = `${c.tipo_cuenta} — ${c.numero_cuenta}`;
            select.appendChild(opt);
        });
    }

    const avisoNoMonetaria = document.getElementById('chequeraAviso');
    if (avisoNoMonetaria) avisoNoMonetaria.hidden = monetarias.length > 0;

    const btn = document.querySelector('#formChequera button[type=submit]');
    if (btn) btn.disabled = monetarias.length === 0;

    document.getElementById('chequeraDireccion').value = perfilDelCliente?.direccion || '';
    alternarDireccionChequera();
}

/** La dirección solo se pide (y se exige) si la entrega es a domicilio. */
function alternarDireccionChequera() {
    const entrega = document.getElementById('chequeraEntrega')?.value;
    const grupo = document.getElementById('grupoDireccionChequera');
    const input = document.getElementById('chequeraDireccion');
    if (!grupo || !input) return;

    const esDomicilio = entrega === 'Domicilio';
    grupo.hidden = !esDomicilio;
    // El required se quita cuando el campo está oculto: un control requerido
    // e invisible bloquea el submit sin mostrar ningún mensaje.
    if (esDomicilio) {
        input.setAttribute('required', '');
    } else {
        input.removeAttribute('required');
    }
}

async function manejarSubmitChequera(e) {
    e.preventDefault();
    const boton = e.submitter || document.querySelector('#formChequera button[type=submit]');

    const cuenta = document.getElementById('chequeraCuenta').value;
    const cantidad = document.getElementById('chequeraCantidad').value;
    const entrega = document.getElementById('chequeraEntrega').value;
    const direccion = document.getElementById('chequeraDireccion').value.trim();

    if (!cuenta) return mostrarResultadoGestion('modalChequera', 'Elige la cuenta monetaria de la chequera.', true);
    if (entrega === 'Domicilio' && direccion.length < 10) {
        return mostrarResultadoGestion('modalChequera', 'Para entrega a domicilio necesitamos una dirección completa.', true);
    }

    window.UVGMotion?.setButtonState(boton, 'loading');

    const { error } = await supabaseClientGestiones
        .from('solicitudes_productos')
        .insert({
            id_usuario: idUsuarioGestiones,
            dpi_cliente: perfilDelCliente?.dpi || null,
            nombre_producto_solicitado: `Chequera de ${cantidad} cheques`,
            telefono_contacto: perfilDelCliente?.telefono || null,
            direccion_entrega: entrega === 'Domicilio' ? direccion : 'Retiro en agencia',
            dato_adicional_etiqueta: 'Cuenta asociada',
            dato_adicional_valor: cuenta
        });

    if (error) {
        window.UVGMotion?.setButtonState(boton, null);
        return mostrarResultadoGestion('modalChequera', traducirError(error), true);
    }

    window.UVGMotion?.setButtonState(boton, 'done');
    mostrarResultadoGestion('modalChequera',
        `Solicitud enviada: chequera de ${cantidad} cheques para la cuenta ${cuenta}, con ${entrega === 'Domicilio' ? 'entrega a domicilio' : 'retiro en agencia'}. Un asesor la revisará.`,
        false);
    await cargarHistorialGestiones();
    setTimeout(() => window.UVGMotion?.setButtonState(boton, null), 2000);
}

// ==========================================
// AYUDANTES COMPARTIDOS
// ==========================================
function pintarOpcionesTarjeta(select, tarjetas, textoVacio) {
    select.innerHTML = '';

    if (tarjetas.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = textoVacio;
        select.appendChild(opt);
        return;
    }

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Selecciona la tarjeta';
    select.appendChild(placeholder);

    tarjetas.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id_tarjeta;
        opt.textContent = `${t.pan_enmascarado} — ${t.estado_tarjeta} (cuenta ${t.numero_cuenta})`;
        select.appendChild(opt);
    });
}

/** Deja los campos de PIN y teléfono aceptando solo dígitos. */
function inicializarFiltrosDeEscritura() {
    document.querySelectorAll('input[data-solo-digitos]').forEach(input => {
        input.addEventListener('input', () => {
            const limpio = input.value.replace(/\D/g, '');
            if (limpio !== input.value) input.value = limpio;
        });
    });

    document.getElementById('chequeraEntrega')?.addEventListener('change', alternarDireccionChequera);
}

/**
 * Las RPCs lanzan `raise exception` con mensajes ya escritos para el cliente,
 * así que se muestran tal cual; solo se cubre el caso de un error de red o
 * de permisos, donde el texto de Postgres no le dice nada a nadie.
 */
function traducirError(error) {
    const mensaje = error?.message || '';
    if (/permission denied|row-level security/i.test(mensaje)) {
        return 'No tienes permiso para hacer esta gestión con tu sesión actual.';
    }
    if (/Failed to fetch|NetworkError/i.test(mensaje)) {
        return 'No hay conexión con el banco. Revisa tu internet e intenta de nuevo.';
    }
    return mensaje || 'Ocurrió un error inesperado. Intenta de nuevo.';
}

function formatearFecha(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-GT', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}
