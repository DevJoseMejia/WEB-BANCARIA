-- Migra la identidad de los clientes a Supabase Auth real (mismo patrón que
-- ya se usó para el staff). Cierra los hallazgos Crítico #3, Alto #4 y #8 del
-- informe de seguridad: ya no existe ningún parámetro ni valor de sesión que
-- el navegador pueda fabricar para hacerse pasar por otro cliente.
--
-- El resto del "negocio" (perfiles_clientes, cuentas, transacciones,
-- solicitudes_*) se sigue consultando por usuarios.id_usuario exactamente
-- igual que hoy -- lo único nuevo es que ese id_usuario ahora se resuelve
-- desde una sesión real (auth.uid()), no desde sessionStorage.

-- ------------------------------------------------------------------
-- 1. Vínculo con Supabase Auth
-- ------------------------------------------------------------------
ALTER TABLE public.usuarios
    ADD COLUMN IF NOT EXISTS auth_uid uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE;

-- password_hash deja de ser la fuente de verdad para clientes nuevos
-- (Supabase Auth maneja esa contraseña); las filas viejas conservan su hash,
-- simplemente ya no se usa para nada.
ALTER TABLE public.usuarios ALTER COLUMN password_hash DROP NOT NULL;

-- ------------------------------------------------------------------
-- 2. Resolver "usuario o correo" antes de autenticar (pre-login, de solo
--    lectura -- Supabase Auth siempre autentica por correo)
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolver_email_login(p_valor text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
    SELECT COALESCE(
        (SELECT email FROM usuarios WHERE username = p_valor LIMIT 1),
        p_valor
    );
$function$;

-- Ya no hace falta: login.js pasa a usar Supabase Auth directo.
DROP FUNCTION IF EXISTS public.intentar_login(text, text);

-- ------------------------------------------------------------------
-- 3. RPCs de dinero: resuelven el dueño real del lado del servidor, no
--    reciben un id_usuario del navegador. Antes de esto, "verificar dueño"
--    dependía de un parámetro que un atacante podía fabricar si ya conocía
--    (leyendo la tabla abierta) el id_usuario de su víctima. Ahora depende
--    únicamente de auth.uid(), que solo Supabase puede firmar.
-- ------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.realizar_transferencia_mismo_banco(text, text, numeric, text, text);

CREATE OR REPLACE FUNCTION public.realizar_transferencia_mismo_banco(
    p_cuenta_origen text,
    p_cuenta_destino text,
    p_monto numeric,
    p_motivo text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
    v_id_usuario_actual uuid;
    v_saldo_origen numeric;
    v_moneda_origen varchar;
    v_estado_origen varchar;
    v_id_usuario_dueno uuid;
    v_moneda_destino varchar;
    v_estado_destino varchar;
    v_codigo_autorizacion varchar;
begin
    select id_usuario into v_id_usuario_actual from usuarios where auth_uid = auth.uid();
    if v_id_usuario_actual is null then
        raise exception 'No se pudo identificar tu sesión.';
    end if;

    if p_monto is null or p_monto <= 0 then
        raise exception 'El monto debe ser mayor a cero';
    end if;

    if p_cuenta_origen = p_cuenta_destino then
        raise exception 'La cuenta origen y la cuenta destino no pueden ser la misma';
    end if;

    select c.saldo_disponible, c.moneda, c.estado, pc.id_usuario
    into v_saldo_origen, v_moneda_origen, v_estado_origen, v_id_usuario_dueno
    from cuentas c
    join perfiles_clientes pc on pc.dpi = c.dpi_cliente
    where c.numero_cuenta = p_cuenta_origen
    for update of c;

    if not found then
        raise exception 'La cuenta origen no existe';
    end if;

    if v_id_usuario_dueno is distinct from v_id_usuario_actual then
        raise exception 'No tienes permiso para operar sobre esta cuenta';
    end if;

    if v_estado_origen <> 'Activa' then
        raise exception 'La cuenta origen no está activa';
    end if;

    if v_saldo_origen < p_monto then
        raise exception 'Saldo insuficiente en la cuenta origen';
    end if;

    select moneda, estado
    into v_moneda_destino, v_estado_destino
    from cuentas
    where numero_cuenta = p_cuenta_destino
    for update;

    if not found then
        raise exception 'La cuenta destino no existe';
    end if;

    if v_estado_destino <> 'Activa' then
        raise exception 'La cuenta destino no está activa';
    end if;

    if v_moneda_origen <> v_moneda_destino then
        raise exception 'No se permiten transferencias entre cuentas de distinta moneda (% a %)', v_moneda_origen, v_moneda_destino;
    end if;

    update cuentas set saldo_disponible = saldo_disponible - p_monto where numero_cuenta = p_cuenta_origen;
    update cuentas set saldo_disponible = saldo_disponible + p_monto where numero_cuenta = p_cuenta_destino;

    v_codigo_autorizacion := 'REF-' || floor(random() * 900000 + 100000)::text;

    insert into transacciones (
        monto, tipo_transaccion, fecha_hora, estado_transaccion,
        codigo_autorizacion, cuenta_origen, cuenta_destino
    ) values (
        p_monto, 'Transferencia Interna', now(), 'Completada',
        v_codigo_autorizacion, p_cuenta_origen, p_cuenta_destino
    );

    return json_build_object(
        'exito', true,
        'cuenta_origen', p_cuenta_origen,
        'cuenta_destino', p_cuenta_destino,
        'monto', p_monto,
        'codigo_autorizacion', v_codigo_autorizacion
    );
end;
$function$;

DROP FUNCTION IF EXISTS public.realizar_pago_servicio(text, numeric, text, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.realizar_pago_servicio(
    p_cuenta_origen text,
    p_monto numeric,
    p_id_servicio text,
    p_nombre_servicio text,
    p_proveedor text,
    p_identificador text,
    p_alias text,
    p_nombre_pagador text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
    v_id_usuario_actual uuid;
    v_saldo_origen numeric;
    v_moneda_origen varchar;
    v_estado_origen varchar;
    v_id_usuario_dueno uuid;
    v_codigo_autorizacion varchar;
begin
    select id_usuario into v_id_usuario_actual from usuarios where auth_uid = auth.uid();
    if v_id_usuario_actual is null then
        raise exception 'No se pudo identificar tu sesión.';
    end if;

    if p_monto is null or p_monto <= 0 then
        raise exception 'El monto debe ser mayor a cero';
    end if;

    select c.saldo_disponible, c.moneda, c.estado, pc.id_usuario
    into v_saldo_origen, v_moneda_origen, v_estado_origen, v_id_usuario_dueno
    from cuentas c
    join perfiles_clientes pc on pc.dpi = c.dpi_cliente
    where c.numero_cuenta = p_cuenta_origen
    for update of c;

    if not found then
        raise exception 'La cuenta origen no existe';
    end if;

    if v_id_usuario_dueno is distinct from v_id_usuario_actual then
        raise exception 'No tienes permiso para operar sobre esta cuenta';
    end if;

    if v_estado_origen <> 'Activa' then
        raise exception 'La cuenta origen no está activa';
    end if;

    if v_saldo_origen < p_monto then
        raise exception 'Saldo insuficiente en la cuenta origen';
    end if;

    update cuentas set saldo_disponible = saldo_disponible - p_monto where numero_cuenta = p_cuenta_origen;

    v_codigo_autorizacion := 'PAG-' || floor(random() * 900000 + 100000)::text;

    insert into pagos_servicios (
        id_usuario, nombre_pagador, id_servicio, nombre_servicio, proveedor,
        identificador_servicio, cuenta_origen, moneda, monto, alias,
        codigo_autorizacion, estado, fecha_pago
    ) values (
        v_id_usuario_actual::text, p_nombre_pagador, p_id_servicio, p_nombre_servicio, p_proveedor,
        p_identificador, p_cuenta_origen, v_moneda_origen, p_monto, p_alias,
        v_codigo_autorizacion, 'Completado', now()
    );

    return json_build_object(
        'exito', true,
        'codigo_autorizacion', v_codigo_autorizacion,
        'monto', p_monto,
        'moneda', v_moneda_origen
    );
end;
$function$;

-- ------------------------------------------------------------------
-- 4. RLS: reemplaza la lectura pública total por "solo el dueño" en las
--    tablas de cliente, resolviendo la identidad vía auth_uid. El staff
--    (ya autenticado con Supabase Auth desde la Fase de admin) conserva su
--    acceso amplio existente sin cambios.
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS "select_publico_usuarios" ON public.usuarios;
CREATE POLICY "propio_select_usuarios" ON public.usuarios
    FOR SELECT USING (auth_uid = auth.uid());
CREATE POLICY "staff_select_usuarios" ON public.usuarios
    FOR SELECT USING (
        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('Trabajador', 'Supervisor', 'Administrador')
    );

DROP POLICY IF EXISTS "select_publico_perfiles_clientes" ON public.perfiles_clientes;
CREATE POLICY "propio_select_perfiles_clientes" ON public.perfiles_clientes
    FOR SELECT USING (
        id_usuario IN (SELECT id_usuario FROM public.usuarios WHERE auth_uid = auth.uid())
    );
CREATE POLICY "staff_select_perfiles_clientes" ON public.perfiles_clientes
    FOR SELECT USING (
        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('Trabajador', 'Supervisor', 'Administrador')
    );

DROP POLICY IF EXISTS "select_publico_cuentas" ON public.cuentas;
CREATE POLICY "propio_select_cuentas" ON public.cuentas
    FOR SELECT USING (
        dpi_cliente IN (
            SELECT pc.dpi FROM public.perfiles_clientes pc
            JOIN public.usuarios u ON u.id_usuario = pc.id_usuario
            WHERE u.auth_uid = auth.uid()
        )
    );
CREATE POLICY "staff_select_cuentas" ON public.cuentas
    FOR SELECT USING (
        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('Trabajador', 'Supervisor', 'Administrador')
    );

DROP POLICY IF EXISTS "Lectura publica transacciones" ON public.transacciones;
CREATE POLICY "propio_select_transacciones" ON public.transacciones
    FOR SELECT USING (
        cuenta_origen IN (
            SELECT c.numero_cuenta FROM public.cuentas c
            JOIN public.perfiles_clientes pc ON pc.dpi = c.dpi_cliente
            JOIN public.usuarios u ON u.id_usuario = pc.id_usuario
            WHERE u.auth_uid = auth.uid()
        )
        OR cuenta_destino IN (
            SELECT c.numero_cuenta FROM public.cuentas c
            JOIN public.perfiles_clientes pc ON pc.dpi = c.dpi_cliente
            JOIN public.usuarios u ON u.id_usuario = pc.id_usuario
            WHERE u.auth_uid = auth.uid()
        )
    );
CREATE POLICY "staff_select_transacciones" ON public.transacciones
    FOR SELECT USING (
        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('Trabajador', 'Supervisor', 'Administrador')
    );

DROP POLICY IF EXISTS "select_publico_solicitudes_cuentas" ON public.solicitudes_cuentas;
CREATE POLICY "propio_select_solicitudes_cuentas" ON public.solicitudes_cuentas
    FOR SELECT USING (
        id_usuario IN (SELECT id_usuario::text FROM public.usuarios WHERE auth_uid = auth.uid())
    );

DROP POLICY IF EXISTS "select_publico_solicitudes_prestamos" ON public.solicitudes_prestamos;
CREATE POLICY "propio_select_solicitudes_prestamos" ON public.solicitudes_prestamos
    FOR SELECT USING (
        id_usuario IN (SELECT id_usuario::text FROM public.usuarios WHERE auth_uid = auth.uid())
    );

DROP POLICY IF EXISTS "select_publico_solicitudes_productos" ON public.solicitudes_productos;
CREATE POLICY "propio_select_solicitudes_productos" ON public.solicitudes_productos
    FOR SELECT USING (
        id_usuario IN (SELECT id_usuario FROM public.usuarios WHERE auth_uid = auth.uid())
    );

DROP POLICY IF EXISTS "select_publico_pagos_servicios" ON public.pagos_servicios;
CREATE POLICY "propio_select_pagos_servicios" ON public.pagos_servicios
    FOR SELECT USING (
        id_usuario IN (SELECT id_usuario::text FROM public.usuarios WHERE auth_uid = auth.uid())
    );
