// CONTROLADOR DE LOGICA: TARJETAS DE CRÉDITO
// Reemplaza por completo al tarjetas.js anterior. El catálogo ya no está
// hardcodeado: se carga desde producto_tarjetas, y el formulario de
// solicitud pide información distinta según la categoría de la tarjeta.

let supabaseClientTarjetas = null;
let mapaTarjetas = {}; // nombre -> registro completo de producto_tarjetas

document.addEventListener('DOMContentLoaded', async () => {

    // 1. Inicializar cliente de Supabase
    if (typeof CONFIG !== 'undefined' && CONFIG.URL_DE_SUPABASE && CONFIG.KEY_ANON_SUPABASE && window.supabase) {
        supabaseClientTarjetas = window.supabase.createClient(CONFIG.URL_DE_SUPABASE, CONFIG.KEY_ANON_SUPABASE);
    } else {
        console.error('No se pudo inicializar Supabase. Revisa que config.example.js se cargue antes de tarjetas.js.');
    }

    // 2. Referencias a elementos del DOM
    const contenedorTarjetas = document.getElementById('contenedorTarjetasProductos');
    const modal = document.getElementById('modalSolicitud');
    const btnCerrarModal = document.getElementById('btnCerrarModal');
    const btnCancelarModal = document.getElementById('btnCancelarModal');
    const formSolicitud = document.getElementById('formSolicitudTarjeta');
    const selectTipoTarjeta = document.getElementById('tipoTarjeta');
    const inputIngresos = document.getElementById('ingresosMensuales');
    const ayudaIngresos = document.getElementById('ayudaIngresosMinimos');
    const campoAdicionalContainer = document.getElementById('campoAdicionalContainer');
    const labelCampoAdicional = document.getElementById('labelCampoAdicional');
    const inputCampoAdicional = document.getElementById('campoAdicional');
    const mensajeEstado = document.getElementById('mensajeEstado');

    if (!supabaseClientTarjetas || !contenedorTarjetas) return;

    // 3. Cargar catálogo real de tarjetas
    await cargarCatalogoTarjetas();

    // 4. Funciones para Abrir y Cerrar Modal
    function abrirModal(nombreTarjeta) {
        if (!modal) return;

        if (mensajeEstado) {
            mensajeEstado.textContent = '';
            mensajeEstado.className = 'mensaje-estado';
        }

        if (selectTipoTarjeta && nombreTarjeta) {
            selectTipoTarjeta.value = nombreTarjeta;
        }

        actualizarFormularioSegunTarjeta(selectTipoTarjeta ? selectTipoTarjeta.value : '');

        modal.style.display = 'flex';
        modal.classList.add('active');
    }

    function cerrarModal() {
        if (!modal) return;
        modal.style.display = 'none';
        modal.classList.remove('active');
        if (formSolicitud) formSolicitud.reset();
        ocultarCampoAdicional();
    }

    // 5. Cargar catálogo desde producto_tarjetas y dibujar las cards + el select
    async function cargarCatalogoTarjetas() {
        try {
            const { data, error } = await supabaseClientTarjetas
                .from('producto_tarjetas')
                .select('*')
                .eq('activo', true)
                .order('orden', { ascending: true });

            if (error) throw error;

            const tarjetas = data || [];
            mapaTarjetas = {};
            tarjetas.forEach(t => { mapaTarjetas[t.nombre] = t; });

            renderizarTarjetas(tarjetas);
            poblarSelectTarjetas(tarjetas);

        } catch (err) {
            console.error('Error al cargar el catálogo de tarjetas:', err);
            contenedorTarjetas.innerHTML = '<p style="color:#ef4444;">No se pudo cargar el catálogo de tarjetas.</p>';
        }
    }

    function renderizarTarjetas(tarjetas) {
        if (tarjetas.length === 0) {
            contenedorTarjetas.innerHTML = '<p style="color:#64748b;">No hay tarjetas disponibles en este momento.</p>';
            return;
        }

        contenedorTarjetas.innerHTML = tarjetas.map(t => `
            <div class="card-producto">
                <div class="badge-producto">${t.categoria}</div>
                <div class="icono-producto">
                    <i class="${t.icono || 'ri-bank-card-line'}"></i>
                </div>
                <h3>${t.nombre}</h3>
                <p class="desc-producto">${t.descripcion || ''}</p>
                <ul class="caracteristicas-list">
                    ${(t.beneficios || []).map(b => `<li><i class="ri-check-line"></i> ${b}</li>`).join('')}
                </ul>
                <button class="btn-filter-primary btn-full btn-solicitar-tarjeta" data-tarjeta="${t.nombre}">
                    ${t.categoria === 'Exclusiva' ? 'Solicitar Evaluación' : 'Solicitar Tarjeta'}
                </button>
            </div>
        `).join('');

        // Reasignar el evento a los botones recién creados
        contenedorTarjetas.querySelectorAll('.btn-solicitar-tarjeta').forEach(boton => {
            boton.addEventListener('click', (e) => {
                const tarjetaNombre = e.currentTarget.getAttribute('data-tarjeta');
                abrirModal(tarjetaNombre);
            });
        });
    }

    function poblarSelectTarjetas(tarjetas) {
        if (!selectTipoTarjeta) return;
        selectTipoTarjeta.innerHTML = '<option value="" disabled selected>Selecciona una tarjeta</option>' +
            tarjetas.map(t => `<option value="${t.nombre}">${t.nombre}</option>`).join('');
    }

    // 6. Ajustar el formulario (ingreso mínimo + campo adicional) según la
    //    tarjeta elegida. Todo sale de producto_tarjetas, nada hardcodeado.
    function actualizarFormularioSegunTarjeta(nombreTarjeta) {
        const tarjeta = mapaTarjetas[nombreTarjeta];
        if (!tarjeta) {
            ocultarCampoAdicional();
            return;
        }

        const ingresoMinimo = Number(tarjeta.ingreso_minimo) || 0;

        if (inputIngresos) {
            inputIngresos.min = ingresoMinimo;
        }
        if (ayudaIngresos) {
            ayudaIngresos.textContent = `Ingreso mínimo requerido para esta tarjeta: Q ${ingresoMinimo.toLocaleString('es-GT')}`;
        }
        validarIngresos();

        // Campo adicional según la categoría del producto
        if (tarjeta.categoria === 'Viajes') {
            mostrarCampoAdicional('Número de Pasaporte', 'Ej. C12345678', 'text');
        } else if (tarjeta.categoria === 'Exclusiva') {
            mostrarCampoAdicional('Ingresos Adicionales / Otras Fuentes de Ingreso (GTQ)', 'Ej. 3000', 'number');
        } else {
            ocultarCampoAdicional();
        }
    }

    function mostrarCampoAdicional(etiqueta, placeholder, tipoInput) {
        if (!campoAdicionalContainer || !labelCampoAdicional || !inputCampoAdicional) return;
        labelCampoAdicional.textContent = etiqueta;
        inputCampoAdicional.placeholder = placeholder;
        inputCampoAdicional.type = tipoInput;
        inputCampoAdicional.required = true;
        campoAdicionalContainer.style.display = 'block';
    }

    function ocultarCampoAdicional() {
        if (!campoAdicionalContainer || !inputCampoAdicional) return;
        campoAdicionalContainer.style.display = 'none';
        inputCampoAdicional.required = false;
        inputCampoAdicional.value = '';
    }

    function validarIngresos() {
        if (!inputIngresos) return;
        const minimo = parseFloat(inputIngresos.min || '0');
        const valor = parseFloat(inputIngresos.value);

        if (!isNaN(valor) && valor < minimo) {
            inputIngresos.setCustomValidity(`El ingreso mínimo para esta tarjeta es Q ${minimo.toLocaleString('es-GT')}.`);
        } else {
            inputIngresos.setCustomValidity('');
        }
    }

    // 7. Eventos generales del modal
    if (btnCerrarModal) btnCerrarModal.addEventListener('click', cerrarModal);
    if (btnCancelarModal) btnCancelarModal.addEventListener('click', cerrarModal);

    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) cerrarModal();
        });
    }

    if (selectTipoTarjeta) {
        selectTipoTarjeta.addEventListener('change', () => {
            actualizarFormularioSegunTarjeta(selectTipoTarjeta.value);
        });
    }

    if (inputIngresos) {
        inputIngresos.addEventListener('input', validarIngresos);
    }

    // 8. Manejo del Envío del Formulario
    if (formSolicitud) {
        formSolicitud.addEventListener('submit', async (e) => {
            e.preventDefault();

            validarIngresos();
            if (!formSolicitud.reportValidity()) return;

            const tipoTarjeta = selectTipoTarjeta ? selectTipoTarjeta.value : '';
            const tarjeta = mapaTarjetas[tipoTarjeta];
            const idUsuario = sessionStorage.getItem('id_usuario') || localStorage.getItem('id_usuario');

            const datosSolicitud = {
                nombre_producto_solicitado: `Tarjeta: ${tipoTarjeta}`,
                estado: 'Pendiente',
                fecha_solicitud: new Date().toISOString(),
                id_usuario: idUsuario || null,
                ingresos_mensuales: parseFloat(inputIngresos.value) || null,
                lugar_trabajo: document.getElementById('lugarTrabajo').value.trim(),
                puesto_trabajo: document.getElementById('puestoTrabajo').value.trim(),
                telefono_contacto: document.getElementById('telefonoContacto').value.trim(),
                direccion_entrega: document.getElementById('direccionEntrega').value.trim(),
                dato_adicional_etiqueta: (campoAdicionalContainer && campoAdicionalContainer.style.display !== 'none' && labelCampoAdicional)
                    ? labelCampoAdicional.textContent
                    : null,
                dato_adicional_valor: (campoAdicionalContainer && campoAdicionalContainer.style.display !== 'none' && inputCampoAdicional)
                    ? inputCampoAdicional.value.trim()
                    : null
            };

            if (mensajeEstado) {
                mensajeEstado.style.color = '#0284c7';
                mensajeEstado.textContent = 'Enviando solicitud...';
            }

            try {
                const { error } = await supabaseClientTarjetas
                    .from('solicitudes_productos')
                    .insert([datosSolicitud]);

                if (error) throw error;

                if (mensajeEstado) {
                    mensajeEstado.style.color = '#16a34a';
                    mensajeEstado.textContent = tarjeta && tarjeta.categoria === 'Exclusiva'
                        ? '¡Solicitud de evaluación enviada con éxito! Un asesor se pondrá en contacto contigo.'
                        : '¡Solicitud enviada con éxito! Nos pondremos en contacto contigo.';
                }

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