let supabaseClientPrestamos = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof CONFIG !== 'undefined' && CONFIG.URL_DE_SUPABASE && CONFIG.KEY_ANON_SUPABASE && window.supabase) {
        supabaseClientPrestamos = window.supabase.createClient(CONFIG.URL_DE_SUPABASE, CONFIG.KEY_ANON_SUPABASE);
    }

    if (!supabaseClientPrestamos) {
        console.error('💥 No se pudo inicializar el cliente de Supabase. Revisa config.example.js.');
        return;
    }

    await cargarPrestamosDisponibles();
});

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

        // Habilitamos la apertura del modal en cada botón recién creado
        contenedor.querySelectorAll('.btn-solicitar').forEach(boton => {
            boton.addEventListener('click', manejarSolicitudPrestamo);
        });

    } catch (err) {
        console.error('💥 Error al cargar los préstamos disponibles:', err);
        contenedor.innerHTML = "<p style='color:#ef4444;'>No se pudieron cargar los préstamos disponibles.</p>";
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
    const textoCuota = document.getElementById('textoCuotaEstimada');

    let pasoActual = 1;

    // --- FUNCIONES DE APERTURA Y CIERRE ---

    // Función para abrir el modal
    window.abrirModalPrestamo = function (nombreProducto, idProducto) {
        if (!modal) return;

        productoSeleccionadoActual = { nombre: nombreProducto, id: idProducto };

        // Resetear estado del formulario y pasos
        pasoActual = 1;
        mostrarPaso(pasoActual);
        if (formSolicitud) formSolicitud.reset();
        if (textoCuota) textoCuota.textContent = 'Q 0.00';

        // Asignar datos del producto si existen
        const tituloModal = document.getElementById('modalTitulo');
        if (tituloModal && nombreProducto) {
            tituloModal.textContent = `Solicitud de ${nombreProducto}`;
        }

        // Mostrar modal
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
    };

    // Función para cerrar el modal
    function cerrarModal() {
        if (!modal) return;
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
    }

    // --- EVENT LISTENERS DE CIERRE ---

    // Botón X
    if (btnCerrarModal) {
        btnCerrarModal.addEventListener('click', cerrarModal);
    }

    // Botón Cancelar / Atrás
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

    // Clic fuera del recuadro blanco
    if (modal) {
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                cerrarModal();
            }
        });
    }

    // --- CONTROL DE PASOS DEL FORMULARIO ---

    function mostrarPaso(paso) {
        // Ocultar todos los pasos
        document.querySelectorAll('.modal-step-content').forEach(el => el.classList.remove('active'));

        // Mostrar el paso solicitado
        const pasoElemento = document.getElementById(`pasoModal${paso}`);
        if (pasoElemento) pasoElemento.classList.add('active');

        // Actualizar el indicador visual de pasos
        document.querySelectorAll('.step-item').forEach(step => {
            const numPaso = parseInt(step.getAttribute('data-step'));
            if (numPaso <= paso) {
                step.classList.add('active');
            } else {
                step.classList.remove('active');
            }
        });

        // Configurar botones según el paso
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

            // Actualizar resumen
            const elResumenMonto = document.getElementById('resumenMonto');
            const elResumenPlazo = document.getElementById('resumenPlazo');
            if (elResumenMonto) {
                elResumenMonto.textContent = `Q ${parseFloat(inputMonto ? inputMonto.value : 0 || 0).toLocaleString('es-GT', {minimumFractionDigits: 2})}`;
            }
            if (elResumenPlazo) {
                elResumenPlazo.textContent = `${selectPlazo ? selectPlazo.value : 12} Meses`;
            }
        } else if (paso === 3) {
            // Paso de éxito
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
                // Registrar la solicitud en Supabase al confirmar en el paso 2
                const ticketAleatorio = `#UVG-2026-${Math.floor(1000 + Math.random() * 9000)}`;

                if (supabaseClientPrestamos) {
                    try {
                        const { error } = await supabaseClientPrestamos
                            .from('solicitudes_productos')
                            .insert([{
                                nombre_producto_solicitado: productoSeleccionadoActual.nombre || 'Préstamo',
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