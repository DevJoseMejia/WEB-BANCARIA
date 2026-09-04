let supabaseClientPrestamos = null;
let idUsuarioPrestamos = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof CONFIG !== 'undefined' && CONFIG.URL_DE_SUPABASE && CONFIG.KEY_ANON_SUPABASE && window.supabase) {
        supabaseClientPrestamos = window.supabase.createClient(CONFIG.URL_DE_SUPABASE, CONFIG.KEY_ANON_SUPABASE);
    }

    if (!supabaseClientPrestamos) {
        console.error('💥 No se pudo inicializar el cliente de Supabase. Revisa config.example.js.');
        return;
    }

    idUsuarioPrestamos = sessionStorage.getItem('id_usuario') || localStorage.getItem('id_usuario');

    await cargarCuotaCatalogoYSolicitante();
});

/**
 * Carga en paralelo el catálogo de préstamos y los datos del solicitante
 * (nombre y correo), para no bloquear uno con el otro.
 */
async function cargarCuotaCatalogoYSolicitante() {
    await Promise.all([
        cargarPrestamosDisponibles(),
        cargarDatosSolicitante()
    ]);
}

/**
 * Trae el catálogo de préstamos activos desde productos_prestamo
 * y arma las tarjetas dinámicamente.
 */
async function cargarPrestamosDisponibles() {
    const contenedor = document.getElementById('contenedorPrestamosDisponibles');
    if (!contenedor) return;

    try {
        const { data: productos, error } = await supabaseClientPrestamos
            .from('productos_prestamo')
            .select('*')
            .eq('activo', true)
            .order('orden', { ascending: true });

        if (error) throw error;

        if (!productos || productos.length === 0) {
            contenedor.innerHTML = "<p style='color:#64748b;'>No hay préstamos disponibles por el momento.</p>";
            return;
        }

        contenedor.innerHTML = productos.map(p => {
            const montoMin = p.monto_minimo !== null ? parseFloat(p.monto_minimo).toLocaleString('es-GT') : null;
            const montoMax = p.monto_maximo !== null ? parseFloat(p.monto_maximo).toLocaleString('es-GT') : null;
            const rangoMonto = (montoMin && montoMax) ? `Q${montoMin} - Q${montoMax}` : '';

            return `
                <div class="card-producto">
                    <div class="icono-producto">
                        <i class="${p.icono || 'ri-funds-line'}"></i>
                    </div>
                    <h3>${p.nombre}</h3>
                    <p class="desc-producto">${p.descripcion}</p>
                    ${rangoMonto ? `<p class="desc-producto"><strong>Monto:</strong> ${rangoMonto}</p>` : ''}
                    ${p.tasa_interes ? `<p class="desc-producto"><strong>Tasa:</strong> ${p.tasa_interes}</p>` : ''}
                    ${p.plazo_maximo_meses ? `<p class="desc-producto"><strong>Plazo máximo:</strong> ${p.plazo_maximo_meses} meses</p>` : ''}
                    <button class="btn-filter-primary btn-full btn-solicitar" data-producto="${p.nombre}" data-id="${p.id}">Solicitar Préstamo</button>
                </div>
            `;
        }).join('');

        contenedor.querySelectorAll('.btn-solicitar').forEach(boton => {
            boton.addEventListener('click', manejarSolicitudPrestamo);
        });

    } catch (err) {
        console.error('💥 Error al cargar los préstamos disponibles:', err);
        contenedor.innerHTML = "<p style='color:#ef4444;'>No se pudieron cargar los préstamos disponibles.</p>";
    }
}

/**
 * Trae nombre/apellidos (perfiles_clientes) y correo (usuarios) del
 * usuario en sesión, para pre-llenar el paso 1 del modal.
 */
async function cargarDatosSolicitante() {
    const inputNombre = document.getElementById('inputNombreSolicitante');
    const inputCorreo = document.getElementById('inputCorreoSolicitante');

    if (!idUsuarioPrestamos) {
        if (inputNombre) inputNombre.placeholder = 'No se pudo identificar al usuario';
        return;
    }

    try {
        const [{ data: perfil, error: errPerfil }, { data: usuario, error: errUsuario }] = await Promise.all([
            supabaseClientPrestamos.from('perfiles_clientes').select('nombres, apellidos').eq('id_usuario', idUsuarioPrestamos).maybeSingle(),
            supabaseClientPrestamos.from('usuarios').select('email').eq('id_usuario', idUsuarioPrestamos).maybeSingle()
        ]);

        if (errPerfil) throw errPerfil;
        if (errUsuario) throw errUsuario;

        if (inputNombre && perfil) {
            inputNombre.value = `${perfil.nombres} ${perfil.apellidos}`;
        }
        if (inputCorreo && usuario) {
            inputCorreo.value = usuario.email || '';
        }

    } catch (err) {
        console.error('💥 Error al cargar los datos del solicitante:', err);
    }
}

/**
 * Conecta el clic de la tarjeta dinámica con la apertura del Modal.
 */
function manejarSolicitudPrestamo(e) {
    const boton = e.currentTarget;
    const nombreProducto = boton.getAttribute('data-producto');
    const idProducto = boton.getAttribute('data-id');

    if (typeof window.abrirModalPrestamo === 'function') {
        window.abrirModalPrestamo(nombreProducto, idProducto);
    } else {
        console.error('La función abrirModalPrestamo no está disponible.');
    }
}

// Variable para almacenar el producto que se está solicitando en el modal
let productoSeleccionadoActual = { nombre: '', id: null };

document.addEventListener('DOMContentLoaded', () => {
    // Referencias de elementos del DOM
    const modal = document.getElementById('modalSolicitudProducto');
    const btnCerrarModal = document.getElementById('btnCerrarModal');
    const btnModalAtras = document.getElementById('btnModalAtras');
    const btnModalSiguiente = document.getElementById('btnModalSiguiente');
    const formSolicitud = document.getElementById('formSolicitudProducto');

    // Campos del formulario y simulador
    const inputMonto = document.getElementById('inputMontoSolicitado');
    const selectPlazo = document.getElementById('selectPlazoMeses');
    const inputIngresos = document.getElementById('inputIngresosMensuales');
    const textoCuota = document.getElementById('textoCuotaEstimada');
    const checkTerminos = document.getElementById('checkTerminos');

    let pasoActual = 1;

    // --- FUNCIONES DE APERTURA Y CIERRE ---

    window.abrirModalPrestamo = function (nombreProducto, idProducto) {
        if (!modal) return;

        productoSeleccionadoActual = { nombre: nombreProducto, id: idProducto };

        pasoActual = 1;
        mostrarPaso(pasoActual);
        if (formSolicitud) formSolicitud.reset();
        if (textoCuota) textoCuota.textContent = 'Q 0.00';

        // El reset() del form también borra los campos readonly de solicitante; los volvemos a llenar
        cargarDatosSolicitante();

        const tituloModal = document.getElementById('modalTitulo');
        if (tituloModal && nombreProducto) {
            tituloModal.textContent = `Solicitud de ${nombreProducto}`;
        }

        const resumenNombre = document.getElementById('resumenNombreProducto');
        if (resumenNombre && nombreProducto) {
            resumenNombre.textContent = nombreProducto;
        }

        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
    };

    function cerrarModal() {
        if (!modal) return;
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
    }

    // --- EVENT LISTENERS DE CIERRE ---

    if (btnCerrarModal) {
        btnCerrarModal.addEventListener('click', cerrarModal);
    }

    if (btnModalAtras) {
        btnModalAtras.addEventListener('click', () => {
            if (pasoActual === 1) {
                cerrarModal();
            } else if (pasoActual === 2) {
                pasoActual = 1;
                mostrarPaso(pasoActual);
            }
        });
    }

    if (modal) {
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                cerrarModal();
            }
        });
    }

    // --- CONTROL DE PASOS DEL FORMULARIO ---

    function mostrarPaso(paso) {
        document.querySelectorAll('.modal-step-content').forEach(el => el.classList.remove('active'));

        const pasoElemento = document.getElementById(`pasoModal${paso}`);
        if (pasoElemento) pasoElemento.classList.add('active');

        document.querySelectorAll('.step-item').forEach(step => {
            const numPaso = parseInt(step.getAttribute('data-step'));
            if (numPaso <= paso) {
                step.classList.add('active');
            } else {
                step.classList.remove('active');
            }
        });

        if (paso === 1) {
            if (btnModalAtras) {
                btnModalAtras.style.display = 'inline-flex';
                btnModalAtras.textContent = 'Cancelar';
            }
            if (btnModalSiguiente) {
                btnModalSiguiente.style.display = 'inline-flex';
                btnModalSiguiente.querySelector('span').textContent = 'Continuar';
            }
        } else if (paso === 2) {
            if (btnModalAtras) {
                btnModalAtras.style.display = 'inline-flex';
                btnModalAtras.textContent = 'Atrás';
            }
            if (btnModalSiguiente) {
                btnModalSiguiente.style.display = 'inline-flex';
                btnModalSiguiente.querySelector('span').textContent = 'Confirmar Solicitud';
            }

            const elResumenMonto = document.getElementById('resumenMonto');
            const elResumenPlazo = document.getElementById('resumenPlazo');
            if (elResumenMonto) {
                elResumenMonto.textContent = `Q ${parseFloat(inputMonto ? inputMonto.value : 0 || 0).toLocaleString('es-GT', { minimumFractionDigits: 2 })}`;
            }
            if (elResumenPlazo) {
                elResumenPlazo.textContent = `${selectPlazo ? selectPlazo.value : 12} Meses`;
            }
        } else if (paso === 3) {
            if (btnModalAtras) btnModalAtras.style.display = 'none';
            if (btnModalSiguiente) {
                btnModalSiguiente.style.display = 'inline-flex';
                btnModalSiguiente.querySelector('span').textContent = 'Finalizar';
            }
        }
    }

    // Evento del botón Siguiente / Enviar
    if (formSolicitud) {
        formSolicitud.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (pasoActual === 1) {
                pasoActual = 2;
                mostrarPaso(pasoActual);
            } else if (pasoActual === 2) {

                if (checkTerminos && !checkTerminos.checked) {
                    checkTerminos.reportValidity();
                    return;
                }

                const ticketAleatorio = `#UVG-2026-${Math.floor(1000 + Math.random() * 9000)}`;
                const cuotaTexto = textoCuota ? textoCuota.textContent.replace(/[^0-9.]/g, '') : '0';

                if (supabaseClientPrestamos) {
                    try {
                        const { error } = await supabaseClientPrestamos
                            .from('solicitudes_prestamos')
                            .insert([{
                                id_usuario: idUsuarioPrestamos,
                                id_producto_prestamo: productoSeleccionadoActual.id,
                                nombre_producto: productoSeleccionadoActual.nombre || 'Préstamo',
                                monto_solicitado: parseFloat(inputMonto ? inputMonto.value : 0) || 0,
                                plazo_meses: parseInt(selectPlazo ? selectPlazo.value : 12, 10),
                                ingresos_mensuales: parseFloat(inputIngresos ? inputIngresos.value : 0) || null,
                                cuota_estimada: parseFloat(cuotaTexto) || null,
                                acepto_terminos: checkTerminos ? checkTerminos.checked : false,
                                numero_gestion: ticketAleatorio,
                                estado: 'Pendiente',
                                fecha_solicitud: new Date().toISOString()
                            }]);

                        if (error) {
                            console.error('Error al guardar en Supabase:', error);
                        }
                    } catch (err) {
                        console.error('Excepción al registrar solicitud:', err);
                    }
                }

                const elTicket = document.getElementById('textoNumeroTicket');
                if (elTicket) elTicket.textContent = ticketAleatorio;

                pasoActual = 3;
                mostrarPaso(pasoActual);
            } else if (pasoActual === 3) {
                cerrarModal();
            }
        });
    }

    // --- CÁLCULO ESTIMADO DE CUOTA ---

    function calcularCuota() {
        if (!inputMonto || !selectPlazo || !textoCuota) return;

        const monto = parseFloat(inputMonto.value) || 0;
        const meses = parseInt(selectPlazo.value) || 12;
        const tasaAnual = 0.12; // 12% estimado

        if (monto > 0) {
            const tasaMensual = tasaAnual / 12;
            const cuota = (monto * tasaMensual) / (1 - Math.pow(1 + tasaMensual, -meses));
            textoCuota.textContent = `Q ${cuota.toFixed(2)}`;
        } else {
            textoCuota.textContent = 'Q 0.00';
        }
    }

    if (inputMonto) inputMonto.addEventListener('input', calcularCuota);
    if (selectPlazo) selectPlazo.addEventListener('change', calcularCuota);
});