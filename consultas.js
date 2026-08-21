// CONTROLADOR DE LOGICA: CONSULTAS Y PRODUCTOS

document.addEventListener('DOMContentLoaded', () => {

    // Inicializar cliente Supabase si las credenciales existen en el scope global
    let supabaseClient = null;
    if (window.supabase && typeof CONFIG !== 'undefined' && CONFIG.URL_DE_SUPABASE && CONFIG.KEY_ANON_SUPABASE) {
        supabaseClient = window.supabase.createClient(CONFIG.URL_DE_SUPABASE, CONFIG.KEY_ANON_SUPABASE);
    } else {
        console.warn("Cliente Supabase o archivo config.js no inicializado. Se usarán datos de respaldo locales.");
    }

    // 1. Cierre de Sesión Operativo
    const btnCerrarSesion = document.getElementById('btnCerrarSesion');
    if (btnCerrarSesion) {
        btnCerrarSesion.addEventListener('click', () => {
            sessionStorage.clear();
            localStorage.clear();
            window.location.href = "Login_personal.html";
        });
    }

    // 2. Lógica del Simulador de Cuotas
    const btnCalcularCuota = document.getElementById('btnCalcularCuota');
    const inputMonto = document.getElementById('monto');
    const selectPlazo = document.getElementById('plazo');
    const contenedorResultado = document.getElementById('resultadoSimulador');

    if (btnCalcularCuota) {
        btnCalcularCuota.addEventListener('click', async (e) => {
            e.preventDefault();

            // Validación de existencia del contenedor
            if (!contenedorResultado) {
                console.error("Error: No se encontró el elemento con id='resultadoSimulador' en el DOM.");
                alert("Ocurrió un error en la vista. No se encontró el contenedor de resultados.");
                return;
            }

            const monto = parseFloat(inputMonto.value);
            const meses = parseInt(selectPlazo.value, 10);

            // Validaciones de entradas
            if (isNaN(monto) || monto <= 0) {
                mostrarMensajeSimulador('Por favor ingresa un monto válido mayor a Q0.00.', 'error');
                return;
            }

            if (isNaN(meses) || meses <= 0) {
                mostrarMensajeSimulador('Por favor selecciona un plazo válido.', 'error');
                return;
            }

            // Tasa por defecto de respaldo (10.5% anual)
            let tasaAnual = 0.105; 

            // Consultar tasa actualizada desde la tabla catalogo_productos en Supabase
            if (supabaseClient) {
                try {
                    const { data, error } = await supabaseClient
                        .from('catalogo_productos')
                        .select('tasa_interes_anual')
                        .eq('codigo_producto', 'PRESTAMO_FLEX')
                        .maybeSingle();

                    if (!error && data && data.tasa_interes_anual) {
                        tasaAnual = parseFloat(data.tasa_interes_anual) / 100;
                    }
                } catch (err) {
                    console.warn("Usando tasa local debido a un fallo en la consulta de Supabase:", err);
                }
            }

            // Cálculo Financiero: Sistema Francés de Amortización
            const tasaMensual = tasaAnual / 12;
            const cuotaMensual = (monto * tasaMensual * Math.pow(1 + tasaMensual, meses)) / 
                                 (Math.pow(1 + tasaMensual, meses) - 1);
            const totalPagar = cuotaMensual * meses;
            const totalIntereses = totalPagar - monto;

            // Renderizado en pantalla
            renderizarResultadoSimulador(cuotaMensual, totalPagar, totalIntereses, tasaAnual * 100);
        });
    }

    // Función para dibujar el resultado estilizado dentro del contenedor
    function renderizarResultadoSimulador(cuota, total, intereses, tasaPorcentaje) {
        contenedorResultado.innerHTML = `
            <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; padding: 14px; border-radius: 8px; text-align: center; margin-top: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.04);">
                <span style="font-size: 0.75rem; display: block; color: #15803d; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                    Cuota Mensual Estimada
                </span>
                <strong style="font-size: 1.6rem; display: block; margin: 4px 0; color: #166534; font-weight: 700;">
                    Q ${cuota.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </strong>
                <div style="border-top: 1px solid #dcfce7; margin-top: 8px; padding-top: 8px; font-size: 0.78rem; color: #166534; text-align: left; display: grid; grid-template-columns: 1fr; gap: 4px;">
                    <div>• Total a pagar: <strong>Q ${total.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
                    <div>• Total intereses: <strong>Q ${intereses.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
                    <div>• Tasa aplicada: <strong>${tasaPorcentaje.toFixed(2)}% Anual</strong></div>
                </div>
            </div>
        `;
    }

    // Función para mostrar alertas de validación o error
    function mostrarMensajeSimulador(mensaje, tipo) {
        const esError = tipo === 'error';
        contenedorResultado.innerHTML = `
            <div style="background-color: ${esError ? '#fee2e2' : '#e0f2fe'}; color: ${esError ? '#991b1b' : '#075985'}; padding: 10px; border-radius: 6px; font-size: 0.85rem; text-align: center; border: 1px solid ${esError ? '#fca5a5' : '#7dd3fc'}; margin-top: 15px;">
                ${mensaje}
            </div>
        `;
    }

    // 3. Captura y Registro de Solicitudes de Productos en Supabase
    const botonesSolicitar = document.querySelectorAll('.btn-solicitar');
    botonesSolicitar.forEach(boton => {
        boton.addEventListener('click', async (e) => {
            const nombreProducto = e.target.getAttribute('data-producto');
            
            const confirmacion = confirm(`¿Deseas solicitar el producto: "${nombreProducto}"?`);
            if (!confirmacion) return;

            if (!supabaseClient) {
                alert("No hay conexión con Supabase configurada.");
                return;
            }

            try {
                const { data, error } = await supabaseClient
                    .from('solicitudes_productos')
                    .insert([
                        {
                            nombre_producto_solicitado: nombreProducto,
                            estado: 'Pendiente',
                            fecha_solicitud: new Date().toISOString()
                        }
                    ]);

                if (error) {
                    console.error("Error en base de datos al solicitar producto:", error);
                    alert("No se pudo registrar la solicitud. Revisa la consola o los permisos de Supabase.");
                } else {
                    alert(`¡Tu solicitud para "${nombreProducto}" ha sido procesada exitosamente! Un asesor se pondrá en contacto.`);
                }

            } catch (err) {
                console.error("Excepción crítica al procesar la solicitud:", err);
                alert("Ocurrió un error inesperado al enviar la solicitud.");
            }
        });
    });

});