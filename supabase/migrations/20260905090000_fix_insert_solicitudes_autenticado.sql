-- Al migrar los clientes a Supabase Auth, su rol de Postgres pasó de `anon`
-- a `authenticated`. Las políticas de INSERT de las solicitudes seguían
-- escritas solo para `anon`, así que dejaron de aplicar y toda solicitud
-- (abrir cuenta, préstamo, tarjeta) fallaba con 403 / "new row violates
-- row-level security policy".
--
-- Se reemplazan por políticas que además son más estrictas que las
-- anteriores: un cliente solo puede crear solicitudes a su propio nombre
-- (antes cualquiera podía insertar una solicitud atribuida a otra persona).

-- ---------------- solicitudes_cuentas ----------------
DROP POLICY IF EXISTS "Insercion publica solicitudes_cuentas" ON public.solicitudes_cuentas;

CREATE POLICY "propio_insert_solicitudes_cuentas" ON public.solicitudes_cuentas
    FOR INSERT WITH CHECK (
        id_usuario IN (SELECT id_usuario::text FROM public.usuarios WHERE auth_uid = auth.uid())
    );

-- ---------------- solicitudes_prestamos ----------------
DROP POLICY IF EXISTS "Insercion publica solicitudes_prestamos" ON public.solicitudes_prestamos;

CREATE POLICY "propio_insert_solicitudes_prestamos" ON public.solicitudes_prestamos
    FOR INSERT WITH CHECK (
        id_usuario IN (SELECT id_usuario::text FROM public.usuarios WHERE auth_uid = auth.uid())
    );

-- ---------------- solicitudes_productos (tarjetas) ----------------
DROP POLICY IF EXISTS "insercion_publica_solicitudes_productos" ON public.solicitudes_productos;

CREATE POLICY "propio_insert_solicitudes_productos" ON public.solicitudes_productos
    FOR INSERT WITH CHECK (
        id_usuario IN (SELECT id_usuario FROM public.usuarios WHERE auth_uid = auth.uid())
    );
