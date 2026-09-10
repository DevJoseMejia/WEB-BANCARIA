-- Gestiones y Seguridad del cliente: las 5 tarjetas de gestiones.html eran
-- botones sin backend. Esta migración les da soporte real:
--   1. PIN de tarjeta (guardado hasheado, nunca en claro)
--   2. Bloqueo preventivo de tarjeta por robo/extravío
--   3. Actualización de datos de contacto del propio cliente
--   4. (chequera y cambio de contraseña no necesitan DDL: la primera usa
--       solicitudes_productos, la segunda usa Supabase Auth)
--
-- De paso cierra una fuga que quedó fuera del endurecimiento de la Fase 4:
-- `tarjetas` seguía con una política SELECT `USING (true)`, así que cualquiera
-- con la anon key podía listar TODAS las tarjetas del banco.

-- ==========================================================
-- 1. Columnas nuevas en tarjetas
-- ==========================================================
ALTER TABLE public.tarjetas
    ADD COLUMN IF NOT EXISTS pin_hash text,
    ADD COLUMN IF NOT EXISTS pin_actualizado_en timestamptz,
    ADD COLUMN IF NOT EXISTS motivo_bloqueo varchar(60),
    ADD COLUMN IF NOT EXISTS fecha_bloqueo timestamptz;

-- El estado 'Bloqueada' debe ser un valor aceptado por la restricción.
ALTER TABLE public.tarjetas DROP CONSTRAINT IF EXISTS chk_estado_tarjeta;
ALTER TABLE public.tarjetas ADD CONSTRAINT chk_estado_tarjeta
    CHECK (estado_tarjeta::text = ANY (ARRAY[
        'Activa'::text,
        'Bloqueada'::text,
        'Vencida'::text,
        'Cancelada'::text
    ]));

-- ==========================================================
-- 2. RLS de tarjetas: solo el dueño (o el staff) ve sus tarjetas
-- ==========================================================
DROP POLICY IF EXISTS select_publico_tarjetas ON public.tarjetas;

-- Cadena de propiedad: tarjeta -> cuenta -> dpi del cliente -> perfil ->
-- usuario -> auth.uid(). Nadie puede falsificar el último eslabón sin la
-- contraseña real del dueño.
CREATE POLICY propio_select_tarjetas ON public.tarjetas
    FOR SELECT USING (
        numero_cuenta IN (
            SELECT c.numero_cuenta
            FROM public.cuentas c
            JOIN public.perfiles_clientes pc ON pc.dpi = c.dpi_cliente
            JOIN public.usuarios u ON u.id_usuario = pc.id_usuario
            WHERE u.auth_uid = auth.uid()
        )
    );

CREATE POLICY staff_select_tarjetas ON public.tarjetas
    FOR SELECT USING (
        ((auth.jwt() -> 'app_metadata') ->> 'role') = ANY (ARRAY[
            'Trabajador', 'Supervisor', 'Administrador'
        ])
    );

-- El PAN cifrado y el hash del PIN no se leen desde el navegador, ni siquiera
-- por el staff. Mismo patrón que password_hash en usuarios: se quita el SELECT
-- de la tabla y se vuelve a dar solo sobre las columnas seguras (un REVOKE por
-- columna NO alcanza para anular un GRANT de tabla).
REVOKE SELECT ON public.tarjetas FROM anon, authenticated;
GRANT SELECT (
    id_tarjeta, pan_enmascarado, fecha_vencimiento, estado_tarjeta,
    limite_diario_compra, numero_cuenta, fecha_emision,
    pin_actualizado_en, motivo_bloqueo, fecha_bloqueo
) ON public.tarjetas TO anon, authenticated;

-- ==========================================================
-- 3. Reiniciar el PIN de una tarjeta propia
-- ==========================================================
CREATE OR REPLACE FUNCTION public.reiniciar_pin_tarjeta(
    p_id_tarjeta uuid,
    p_pin text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
declare
    v_id_usuario uuid;
    v_estado varchar;
    v_pan varchar;
begin
    select id_usuario into v_id_usuario from usuarios where auth_uid = auth.uid();
    if v_id_usuario is null then
        raise exception 'No se pudo identificar tu sesión.';
    end if;

    if p_pin is null or p_pin !~ '^[0-9]{4}$' then
        raise exception 'El PIN debe ser exactamente 4 dígitos.';
    end if;

    -- Un PIN de 4 dígitos iguales o en secuencia es trivial de adivinar.
    if p_pin ~ '^(.)\1{3}$' then
        raise exception 'El PIN no puede tener los 4 dígitos iguales.';
    end if;
    if position(p_pin in '0123456789') > 0 or position(p_pin in '9876543210') > 0 then
        raise exception 'El PIN no puede ser una secuencia consecutiva.';
    end if;

    -- Verificar propiedad de la tarjeta antes de tocarla.
    select t.estado_tarjeta, t.pan_enmascarado
    into v_estado, v_pan
    from tarjetas t
    join cuentas c on c.numero_cuenta = t.numero_cuenta
    join perfiles_clientes pc on pc.dpi = c.dpi_cliente
    where t.id_tarjeta = p_id_tarjeta and pc.id_usuario = v_id_usuario
    for update of t;

    if not found then
        raise exception 'La tarjeta no existe o no es tuya.';
    end if;

    if v_estado <> 'Activa' then
        raise exception 'Solo puedes cambiar el PIN de una tarjeta activa (esta está %).', v_estado;
    end if;

    -- Se guarda hasheado con bcrypt: ni el banco puede recuperar el PIN.
    update tarjetas
    set pin_hash = crypt(p_pin::text, gen_salt('bf')),
        pin_actualizado_en = now()
    where id_tarjeta = p_id_tarjeta;

    return json_build_object(
        'exito', true,
        'tarjeta', v_pan,
        'actualizado_en', now()
    );
end;
$function$;

-- ==========================================================
-- 4. Bloqueo preventivo de una tarjeta propia
-- ==========================================================
CREATE OR REPLACE FUNCTION public.bloquear_tarjeta_propia(
    p_id_tarjeta uuid,
    p_motivo text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
    v_id_usuario uuid;
    v_estado varchar;
    v_pan varchar;
begin
    select id_usuario into v_id_usuario from usuarios where auth_uid = auth.uid();
    if v_id_usuario is null then
        raise exception 'No se pudo identificar tu sesión.';
    end if;

    if p_motivo not in ('Robo', 'Extravío', 'Sospecha de fraude', 'Deterioro') then
        raise exception 'Motivo de bloqueo no válido.';
    end if;

    select t.estado_tarjeta, t.pan_enmascarado
    into v_estado, v_pan
    from tarjetas t
    join cuentas c on c.numero_cuenta = t.numero_cuenta
    join perfiles_clientes pc on pc.dpi = c.dpi_cliente
    where t.id_tarjeta = p_id_tarjeta and pc.id_usuario = v_id_usuario
    for update of t;

    if not found then
        raise exception 'La tarjeta no existe o no es tuya.';
    end if;

    if v_estado = 'Bloqueada' then
        raise exception 'Esa tarjeta ya está bloqueada.';
    end if;

    -- El bloqueo es inmediato y el cliente NO puede desbloquearla solo: para
    -- reactivarla tiene que pasar por un cajero (staff_update_tarjetas).
    update tarjetas
    set estado_tarjeta = 'Bloqueada',
        motivo_bloqueo = p_motivo,
        fecha_bloqueo = now()
    where id_tarjeta = p_id_tarjeta;

    return json_build_object(
        'exito', true,
        'tarjeta', v_pan,
        'motivo', p_motivo,
        'fecha_bloqueo', now()
    );
end;
$function$;

-- ==========================================================
-- 5. Actualización de datos de contacto propios
-- ==========================================================
-- Deliberadamente NO se da UPDATE sobre perfiles_clientes al cliente: solo
-- esta RPC, y solo para teléfono y dirección. Nombres, DPI y fecha de
-- nacimiento son datos de identidad que únicamente un cajero puede corregir.
CREATE OR REPLACE FUNCTION public.actualizar_datos_contacto(
    p_telefono text,
    p_direccion text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
    v_id_usuario uuid;
    v_telefono text;
    v_direccion text;
begin
    select id_usuario into v_id_usuario from usuarios where auth_uid = auth.uid();
    if v_id_usuario is null then
        raise exception 'No se pudo identificar tu sesión.';
    end if;

    v_telefono := trim(coalesce(p_telefono, ''));
    v_direccion := trim(coalesce(p_direccion, ''));

    -- Mismo formato que exige el registro de clientes en el portal del cajero.
    if v_telefono !~ '^\+502[0-9]{8}$' then
        raise exception 'El teléfono debe ser +502 seguido de 8 dígitos.';
    end if;

    if length(v_direccion) < 10 then
        raise exception 'La dirección debe tener al menos 10 caracteres.';
    end if;

    update perfiles_clientes
    set telefono = v_telefono,
        direccion = v_direccion
    where id_usuario = v_id_usuario;

    if not found then
        raise exception 'No se encontró tu perfil de cliente.';
    end if;

    return json_build_object(
        'exito', true,
        'telefono', v_telefono,
        'direccion', v_direccion
    );
end;
$function$;

-- Estas 3 RPCs resuelven al dueño con auth.uid(), así que un usuario anónimo
-- no tiene nada que hacer con ellas.
REVOKE EXECUTE ON FUNCTION public.reiniciar_pin_tarjeta(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.bloquear_tarjeta_propia(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.actualizar_datos_contacto(text, text) FROM anon;
