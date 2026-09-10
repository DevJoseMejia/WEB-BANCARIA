-- El panel de cajero necesita poder LEER (y luego aprobar/rechazar) las
-- solicitudes que los clientes ya están generando (apertura de cuenta,
-- préstamos, tarjetas), pero hoy no existe ninguna política que se los
-- permita. Se agrega SELECT + UPDATE (para cambiar el estado) para staff,
-- dejando intacto el INSERT público que ya usan los clientes.

ALTER TABLE public.solicitudes_cuentas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitudes_prestamos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitudes_productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagos_servicios ENABLE ROW LEVEL SECURITY;

-- solicitudes_productos no tenía RLS: replicamos el INSERT público que ya
-- usaban tarjetas.js/consultas.js para no romper nada existente.
CREATE POLICY "insercion_publica_solicitudes_productos" ON public.solicitudes_productos
    FOR INSERT WITH CHECK (true);

-- Lectura para staff en las 3 tablas de solicitudes
CREATE POLICY "staff_select_solicitudes_cuentas" ON public.solicitudes_cuentas
    FOR SELECT USING (
        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('Trabajador', 'Supervisor', 'Administrador')
    );

CREATE POLICY "staff_select_solicitudes_prestamos" ON public.solicitudes_prestamos
    FOR SELECT USING (
        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('Trabajador', 'Supervisor', 'Administrador')
    );

CREATE POLICY "staff_select_solicitudes_productos" ON public.solicitudes_productos
    FOR SELECT USING (
        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('Trabajador', 'Supervisor', 'Administrador')
    );

-- Actualización para staff (aprobar / rechazar) en las 3 tablas de solicitudes
CREATE POLICY "staff_update_solicitudes_cuentas" ON public.solicitudes_cuentas
    FOR UPDATE USING (
        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('Trabajador', 'Supervisor', 'Administrador')
    );

CREATE POLICY "staff_update_solicitudes_prestamos" ON public.solicitudes_prestamos
    FOR UPDATE USING (
        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('Trabajador', 'Supervisor', 'Administrador')
    );

CREATE POLICY "staff_update_solicitudes_productos" ON public.solicitudes_productos
    FOR UPDATE USING (
        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('Trabajador', 'Supervisor', 'Administrador')
    );

-- pagos_servicios: lectura pública (mismo criterio que usuarios/cuentas/
-- transacciones hoy: el cliente lee con el anon key, sin Supabase Auth
-- propio) para que a futuro se pueda mostrar el historial de pagos, y
-- lectura de staff explícita también.
CREATE POLICY "select_publico_pagos_servicios" ON public.pagos_servicios
    FOR SELECT USING (true);
