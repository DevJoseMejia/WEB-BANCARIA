-- Portal administrativo (staff) separado del sitio de clientes.
-- 1) Desacopla la identidad del personal de la tabla `usuarios` de clientes:
--    ahora vive en auth.users (Supabase Auth), enlazada por perfiles_empleados.auth_uid.
-- 2) Generador de códigos de empleado (CAJ-0001, CAJ-0002, ...) para altas en lote.
-- 3) RLS mínimo y quirúrgico: mismo acceso de lectura público que existía sin RLS
--    (para no romper login/dashboard/transferencias actuales), pero la escritura
--    en usuarios/perfiles_clientes/cuentas queda restringida a staff autenticado.

-- ------------------------------------------------------------------
-- 1. Identidad de staff desacoplada de `usuarios`
-- ------------------------------------------------------------------
ALTER TABLE public.perfiles_empleados
    ALTER COLUMN id_usuario DROP NOT NULL;

ALTER TABLE public.perfiles_empleados
    ADD COLUMN IF NOT EXISTS auth_uid uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE;

-- ------------------------------------------------------------------
-- 2. Generador de código de empleado
-- ------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.empleado_codigo_seq START WITH 1;

CREATE OR REPLACE FUNCTION public.siguiente_codigo_empleado()
RETURNS text
LANGUAGE sql
AS $$
    SELECT 'CAJ-' || lpad(nextval('public.empleado_codigo_seq')::text, 4, '0');
$$;

REVOKE EXECUTE ON FUNCTION public.siguiente_codigo_empleado() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.siguiente_codigo_empleado() TO service_role;

-- ------------------------------------------------------------------
-- 3. RLS mínimo para que solo staff autenticado pueda dar de alta clientes
-- ------------------------------------------------------------------
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perfiles_clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cuentas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perfiles_empleados ENABLE ROW LEVEL SECURITY;

-- Lectura: igual de abierta que el comportamiento actual (RLS off), para no
-- romper login.js / banca_personal.js / tranferencias.js, que leen con el anon key.
CREATE POLICY "select_publico_usuarios" ON public.usuarios
    FOR SELECT USING (true);

CREATE POLICY "select_publico_perfiles_clientes" ON public.perfiles_clientes
    FOR SELECT USING (true);

CREATE POLICY "select_publico_cuentas" ON public.cuentas
    FOR SELECT USING (true);

-- Escritura: solo staff autenticado (rol embebido en su JWT de Supabase Auth).
CREATE POLICY "staff_insert_usuarios" ON public.usuarios
    FOR INSERT WITH CHECK (
        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('Trabajador', 'Supervisor', 'Administrador')
    );

CREATE POLICY "staff_insert_perfiles_clientes" ON public.perfiles_clientes
    FOR INSERT WITH CHECK (
        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('Trabajador', 'Supervisor', 'Administrador')
    );

CREATE POLICY "staff_insert_cuentas" ON public.cuentas
    FOR INSERT WITH CHECK (
        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('Trabajador', 'Supervisor', 'Administrador')
    );

-- perfiles_empleados: cada empleado lee su propia fila; un Administrador las lee todas.
-- (Los INSERT los hace únicamente la Edge Function vía service_role, que ignora RLS.)
CREATE POLICY "staff_select_propio_perfil" ON public.perfiles_empleados
    FOR SELECT USING (auth_uid = auth.uid());

CREATE POLICY "admin_select_todos_los_perfiles" ON public.perfiles_empleados
    FOR SELECT USING (
        (auth.jwt() -> 'app_metadata' ->> 'role') = 'Administrador'
    );
