// CONTROLADOR: CATÁLOGO DE PRÉSTAMOS DISPONIBLES PARA SOLICITAR

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
 * y arma las tarjetas dinámicamente, con el mismo diseño (mismas
 * clases CSS) que ya tenías con las tarjetas estáticas.
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
                    <button class="btn-filter-primary btn-full btn-solicitar" data-producto="${p.nombre}">Solicitar Préstamo</button>
                </div>
            `;
        }).join('');

        // Habilitamos el envío de la solicitud en cada botón recién creado
        contenedor.querySelectorAll('.btn-solicitar').forEach(boton => {
            boton.addEventListener('click', manejarSolicitudPrestamo);
        });

    } catch (err) {
        console.error('💥 Error al cargar los préstamos disponibles:', err);
        contenedor.innerHTML = "<p style='color:#ef4444;'>No se pudieron cargar los préstamos disponibles.</p>";
    }
}

/**
 * Registra la solicitud en la tabla solicitudes_productos, siguiendo
 * el mismo patrón que consultas.js y solicitar_cuenta.js.
 */
async function manejarSolicitudPrestamo(e) {
    const nombreProducto = e.target.getAttribute('data-producto');
    const confirmacion = confirm(`¿Deseas solicitar el producto: "${nombreProducto}"?`);
    if (!confirmacion) return;

    if (!supabaseClientPrestamos) {
        alert('No hay conexión con Supabase configurada.');
        return;
    }

    try {
        const { error } = await supabaseClientPrestamos
            .from('solicitudes_productos')
            .insert([{
                nombre_producto_solicitado: nombreProducto,
                estado: 'Pendiente',
                fecha_solicitud: new Date().toISOString()
            }]);

        if (error) {
            console.error('Error en base de datos al solicitar préstamo:', error);
            alert('No se pudo registrar la solicitud. Revisa la consola o los permisos de Supabase.');
        } else {
            alert(`¡Tu solicitud para "${nombreProducto}" ha sido procesada exitosamente! Un asesor se pondrá en contacto.`);
        }
    } catch (err) {
        console.error('Excepción crítica al procesar la solicitud:', err);
        alert('Ocurrió un error inesperado al enviar la solicitud.');
    }
}