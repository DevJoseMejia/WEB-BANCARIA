let supabaseClientTarjetas = null;

document.addEventListener('DOMContentLoaded', () => {
    // 1. Inicializar cliente de Supabase
    if (typeof CONFIG !== 'undefined' && CONFIG.URL_DE_SUPABASE && CONFIG.KEY_ANON_SUPABASE && window.supabase) {
        supabaseClientTarjetas = window.supabase.createClient(CONFIG.URL_DE_SUPABASE, CONFIG.KEY_ANON_SUPABASE);
    }

    // 2. Referencias a elementos del DOM
    const modal = document.getElementById('modalSolicitud');
    const btnCerrarModal = document.getElementById('btnCerrarModal');
    const btnCancelarModal = document.getElementById('btnCancelarModal');
    const formSolicitud = document.getElementById('formSolicitudTarjeta');
    const selectTipoTarjeta = document.getElementById('tipoTarjeta');
    const mensajeEstado = document.getElementById('mensajeEstado');
    const botonesSolicitar = document.querySelectorAll('.btn-solicitar-tarjeta');

    // 3. Funciones para Abrir y Cerrar Modal
    function abrirModal(nombreTarjeta) {
        if (!modal) return;
        
        // Limpiar mensajes previos
        if (mensajeEstado) {
            mensajeEstado.textContent = '';
            mensajeEstado.className = 'mensaje-estado';
        }

        // Preseleccionar la tarjeta correspondiente en el select
        if (selectTipoTarjeta && nombreTarjeta) {
            selectTipoTarjeta.value = nombreTarjeta;
        }

        modal.style.display = 'flex';
        modal.classList.add('active');
    }

    function cerrarModal() {
        if (!modal) return;
        modal.style.display = 'none';
        modal.classList.remove('active');
        if (formSolicitud) formSolicitud.reset();
    }

    // 4. Asignar Eventos a los botones "Solicitar Tarjeta"
    botonesSolicitar.forEach(boton => {
        boton.addEventListener('click', (e) => {
            const tarjetaNombre = e.currentTarget.getAttribute('data-tarjeta');
            abrirModal(tarjetaNombre);
        });
    });

    // 5. Asignar Eventos de Cierre del Modal
    if (btnCerrarModal) btnCerrarModal.addEventListener('click', cerrarModal);
    if (btnCancelarModal) btnCancelarModal.addEventListener('click', cerrarModal);

    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) cerrarModal();
        });
    }

    // 6. Manejo del Envío del Formulario
    if (formSolicitud) {
        formSolicitud.addEventListener('submit', async (e) => {
            e.preventDefault();

            const tipoTarjeta = selectTipoTarjeta ? selectTipoTarjeta.value : '';

            if (mensajeEstado) {
                mensajeEstado.style.color = '#0284c7';
                mensajeEstado.textContent = 'Enviando solicitud...';
            }

            try {
                if (supabaseClientTarjetas) {
                    const { error } = await supabaseClientTarjetas
                        .from('solicitudes_productos')
                        .insert([{
                            nombre_producto_solicitado: `Tarjeta: ${tipoTarjeta}`,
                            estado: 'Pendiente',
                            fecha_solicitud: new Date().toISOString()
                        }]);

                    if (error) throw error;
                }

                if (mensajeEstado) {
                    mensajeEstado.style.color = '#16a34a';
                    mensajeEstado.textContent = '¡Solicitud enviada con éxito! Nos pondremos en contacto contigo.';
                }

                // Cerrar el modal automáticamente tras 2 segundos de éxito
                setTimeout(() => {
                    cerrarModal();
                }, 2000);

            } catch (err) {
                console.error('Error al procesar la solicitud:', err);
                if (mensajeEstado) {
                    mensajeEstado.style.color = '#dc2626';
                    mensajeEstado.textContent = 'Ocurrió un error al enviar la solicitud. Inténtalo de nuevo.';
                }
            }
        });
    }
});