// CONTROLADOR: CATÁLOGO DE CUENTAS DISPONIBLES PARA SOLICITAR

let supabaseClientCuentas = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof CONFIG !== 'undefined' && CONFIG.URL_DE_SUPABASE && CONFIG.KEY_ANON_SUPABASE && window.supabase) {
        supabaseClientCuentas = window.supabase.createClient(CONFIG.URL_DE_SUPABASE, CONFIG.KEY_ANON_SUPABASE);
    }

    if (!supabaseClientCuentas) {
        console.error('💥 No se pudo inicializar el cliente de Supabase. Revisa config.example.js.');
        return;
    }

    await cargarCuentasDisponibles();
});

/**
 * Trae el catálogo de cuentas activas desde la tabla productos_cuenta
 * y arma las tarjetas dinámicamente, manteniendo el mismo diseño
 * (mismas clases CSS) que ya tenías con las tarjetas estáticas.
 */
async function cargarCuentasDisponibles() {
    const contenedor = document.getElementById('contenedorCuentasDisponibles');
    if (!contenedor) return;

    try {
        const { data: productos, error } = await supabaseClientCuentas
            .from('productos_cuenta')
            .select('*')
            .eq('activo', true)
            .order('orden', { ascending: true });

        if (error) throw error;

        if (!productos || productos.length === 0) {
            contenedor.innerHTML = "<p style='color:#64748b;'>No hay cuentas disponibles por el momento.</p>";
            return;
        }

        contenedor.innerHTML = productos.map(p => `
            <div class="card-producto">
                <div class="icono-producto">
                    <i class="${p.icono || 'ri-bank-card-line'}"></i>
                </div>
                <h3>${p.nombre}</h3>
                <p class="desc-producto">${p.descripcion}</p>
                ${p.monto_minimo_apertura ? `<p class="desc-producto"><strong>Apertura desde:</strong> ${p.monto_minimo_apertura}</p>` : ''}
                <button class="btn-filter-primary btn-full btn-solicitar" data-producto="${p.nombre}">Solicitar Cuenta</button>
            </div>
        `).join('');

        // Habilitamos el envío de la solicitud en cada botón recién creado
        contenedor.querySelectorAll('.btn-solicitar').forEach(boton => {
            boton.addEventListener('click', manejarSolicitudCuenta);
        });

    } catch (err) {
        console.error('💥 Error al cargar las cuentas disponibles:', err);
        contenedor.innerHTML = "<p style='color:#ef4444;'>No se pudieron cargar las cuentas disponibles.</p>";
    }
}

/**
 * Registra la solicitud de apertura en la tabla solicitudes_productos,
 * siguiendo el mismo patrón que ya usa consultas.js para solicitar
 * otros productos.
 */
async function manejarSolicitudCuenta(e) {
    const nombreProducto = e.target.getAttribute('data-producto');
    const confirmacion = confirm(`¿Deseas solicitar la apertura de: "${nombreProducto}"?`);
    if (!confirmacion) return;

    if (!supabaseClientCuentas) {
        alert('No hay conexión con Supabase configurada.');
        return;
    }

    try {
        const { error } = await supabaseClientCuentas
            .from('solicitudes_productos')
            .insert([{
                nombre_producto_solicitado: nombreProducto,
                estado: 'Pendiente',
                fecha_solicitud: new Date().toISOString()
            }]);

        if (error) {
            console.error('Error en base de datos al solicitar cuenta:', error);
            alert('No se pudo registrar la solicitud. Revisa la consola o los permisos de Supabase.');
        } else {
            alert(`¡Tu solicitud para "${nombreProducto}" ha sido procesada exitosamente! Un asesor se pondrá en contacto.`);
        }
    } catch (err) {
        console.error('Excepción crítica al procesar la solicitud:', err);
        alert('Ocurrió un error inesperado al enviar la solicitud.');
    }
}