-- Fase 4 de seguridad: cierra los hallazgos Crítico #2, Alto #5/#6/#7, Medio #10
-- del informe. Un hallazgo (Crítico #3 / Alto #4, la exposición de lectura en
-- usuarios/perfiles_clientes/cuentas/transacciones) requiere migrar a los
-- clientes a Supabase Auth real -- eso queda fuera de esta migración a
-- propósito, se aborda aparte.

-- ------------------------------------------------------------------
-- Crítico #2: tarjetas sin RLS -- cualquiera podía reactivar una tarjeta
-- bloqueada o subir su límite de compra con un UPDATE directo.
-- ------------------------------------------------------------------
ALTER TABLE public.tarjetas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_publico_tarjetas" ON public.tarjetas
    FOR SELECT USING (true);

CREATE POLICY "staff_update_tarjetas" ON public.tarjetas
    FOR UPDATE USING (
        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('Trabajador', 'Supervisor', 'Administrador')
    );

-- ------------------------------------------------------------------
-- Alto #5: beneficiarios sin RLS -- se podía saltar el período de
-- enfriamiento de 24h con un UPDATE directo a fin_enfriamiento. Hoy ningún
-- código del sitio usa esta tabla todavía, así que se cierra por completo
-- salvo lectura de staff (para cuando se construya esa función).
-- ------------------------------------------------------------------
ALTER TABLE public.beneficiarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_select_beneficiarios" ON public.beneficiarios
    FOR SELECT USING (
        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('Trabajador', 'Supervisor', 'Administrador')
    );

-- ------------------------------------------------------------------
-- Alto #6: logs_accesos sin RLS -- cualquiera podía leer o borrar el rastro
-- de auditoría. login.js sí necesita poder insertar (registra cada intento
-- de acceso); nadie más que Administrador/Auditor debería poder leerlos, y
-- nadie puede modificarlos ni borrarlos (log inmutable).
-- ------------------------------------------------------------------
ALTER TABLE public.logs_accesos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "insercion_publica_logs_accesos" ON public.logs_accesos
    FOR INSERT WITH CHECK (true);

CREATE POLICY "staff_select_logs_accesos" ON public.logs_accesos
    FOR SELECT USING (
        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('Administrador', 'Auditor')
    );

-- ------------------------------------------------------------------
-- Medio #10: catálogos sin RLS -- lectura pública era la intención (tasas,
-- roles, productos disponibles), pero sin RLS también quedaban escribibles
-- por cualquiera. Se deja la misma lectura abierta, se cierra la escritura.
-- ------------------------------------------------------------------
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_servicios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos_cuenta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos_prestamo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_publico_roles" ON public.roles FOR SELECT USING (true);
CREATE POLICY "select_publico_catalogo_productos" ON public.catalogo_productos FOR SELECT USING (true);
CREATE POLICY "select_publico_catalogo_servicios" ON public.catalogo_servicios FOR SELECT USING (true);
CREATE POLICY "select_publico_productos_cuenta" ON public.productos_cuenta FOR SELECT USING (true);
CREATE POLICY "select_publico_productos_prestamo" ON public.productos_prestamo FOR SELECT USING (true);

-- ------------------------------------------------------------------
-- Alto #7 + Medio #9: login.js armaba el filtro con texto del usuario
-- directo en la sintaxis .or() de PostgREST (inyectable), y además exponía
-- password_hash completo a cualquiera con el anon key vía SELECT abierto.
-- Esta RPC hace la búsqueda y la verificación del lado del servidor, con
-- parámetros ligados (no concatenación de texto) y sin devolver el hash
-- jamás al cliente.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.intentar_login(p_valor text, p_password text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
declare
    v_usuario record;
    v_password_valido boolean;
begin
    select id_usuario, password_hash, estado_cuenta, id_rol
    into v_usuario
    from usuarios
    where email = p_valor or username = p_valor
    limit 1;

    if not found then
        return json_build_object('valido', false);
    end if;

    v_password_valido := (v_usuario.password_hash = crypt(p_password, v_usuario.password_hash::text));

    if not v_password_valido then
        return json_build_object('valido', false);
    end if;

    return json_build_object(
        'valido', true,
        'id_usuario', v_usuario.id_usuario,
        'estado_cuenta', v_usuario.estado_cuenta,
        'id_rol', v_usuario.id_rol
    );
end;
$function$;

-- password_hash ya no lo necesita leer ningún cliente directo (login.js pasa
-- a usar intentar_login, que corre con privilegios propios y lo ignora).
-- En Postgres un REVOKE a nivel de columna NO le gana a un GRANT amplio ya
-- existente a nivel de tabla (el GRANT de tabla implica todas las columnas),
-- así que hay que revocar el SELECT de toda la tabla primero y re-otorgarlo
-- solo en las columnas que sí deben seguir siendo legibles.
REVOKE SELECT ON public.usuarios FROM anon, authenticated;
GRANT SELECT (id_usuario, email, estado_cuenta, intentos_fallidos, requiere_mfa, id_rol, fecha_creacion, ultimo_login, username, celular)
    ON public.usuarios TO anon, authenticated;
