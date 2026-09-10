-- Las RPCs de movimiento de dinero (transferencia y pago de servicios)
-- validaban saldo/estado de la cuenta origen, pero nunca verificaban que
-- esa cuenta perteneciera al usuario que hace la operación. Cualquiera con
-- el anon key podía invocar la función directo con el numero_cuenta de otra
-- persona (no es secreto, aparece en recibos) y mover su dinero. Se agrega
-- la verificación de dueño usando perfiles_clientes.id_usuario.

-- Cambia la firma (se agrega p_id_usuario): hay que borrar la versión vieja
-- de 4 parámetros explícitamente, porque CREATE OR REPLACE con una firma
-- distinta crea una función sobrecargada nueva en vez de reemplazarla, y
-- dejaría la versión vulnerable (sin verificación de dueño) seguir existiendo.
DROP FUNCTION IF EXISTS public.realizar_transferencia_mismo_banco(text, text, numeric, text);

CREATE OR REPLACE FUNCTION public.realizar_transferencia_mismo_banco(
    p_cuenta_origen text,
    p_cuenta_destino text,
    p_monto numeric,
    p_motivo text,
    p_id_usuario text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
    v_saldo_origen numeric;
    v_moneda_origen varchar;
    v_estado_origen varchar;
    v_id_usuario_dueno uuid;
    v_moneda_destino varchar;
    v_estado_destino varchar;
    v_codigo_autorizacion varchar;
begin
    if p_monto is null or p_monto <= 0 then
        raise exception 'El monto debe ser mayor a cero';
    end if;

    if p_cuenta_origen = p_cuenta_destino then
        raise exception 'La cuenta origen y la cuenta destino no pueden ser la misma';
    end if;

    -- Bloqueamos la fila de origen para evitar condiciones de carrera, y de
    -- una vez traemos quién es el dueño real de la cuenta (perfiles_clientes.id_usuario).
    select c.saldo_disponible, c.moneda, c.estado, pc.id_usuario
    into v_saldo_origen, v_moneda_origen, v_estado_origen, v_id_usuario_dueno
    from cuentas c
    join perfiles_clientes pc on pc.dpi = c.dpi_cliente
    where c.numero_cuenta = p_cuenta_origen
    for update of c;

    if not found then
        raise exception 'La cuenta origen no existe';
    end if;

    if p_id_usuario is null or v_id_usuario_dueno is null or v_id_usuario_dueno::text <> p_id_usuario then
        raise exception 'No tienes permiso para operar sobre esta cuenta';
    end if;

    if v_estado_origen <> 'Activa' then
        raise exception 'La cuenta origen no está activa';
    end if;

    if v_saldo_origen < p_monto then
        raise exception 'Saldo insuficiente en la cuenta origen';
    end if;

    -- Bloqueamos también la fila destino
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

    update cuentas
    set saldo_disponible = saldo_disponible - p_monto
    where numero_cuenta = p_cuenta_origen;

    update cuentas
    set saldo_disponible = saldo_disponible + p_monto
    where numero_cuenta = p_cuenta_destino;

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

CREATE OR REPLACE FUNCTION public.realizar_pago_servicio(
    p_cuenta_origen text,
    p_monto numeric,
    p_id_servicio text,
    p_nombre_servicio text,
    p_proveedor text,
    p_identificador text,
    p_alias text,
    p_id_usuario text,
    p_nombre_pagador text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
    v_saldo_origen numeric;
    v_moneda_origen varchar;
    v_estado_origen varchar;
    v_id_usuario_dueno uuid;
    v_codigo_autorizacion varchar;
begin
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

    if p_id_usuario is null or v_id_usuario_dueno is null or v_id_usuario_dueno::text <> p_id_usuario then
        raise exception 'No tienes permiso para operar sobre esta cuenta';
    end if;

    if v_estado_origen <> 'Activa' then
        raise exception 'La cuenta origen no está activa';
    end if;

    if v_saldo_origen < p_monto then
        raise exception 'Saldo insuficiente en la cuenta origen';
    end if;

    update cuentas
    set saldo_disponible = saldo_disponible - p_monto
    where numero_cuenta = p_cuenta_origen;

    v_codigo_autorizacion := 'PAG-' || floor(random() * 900000 + 100000)::text;

    insert into pagos_servicios (
        id_usuario, nombre_pagador, id_servicio, nombre_servicio, proveedor,
        identificador_servicio, cuenta_origen, moneda, monto, alias,
        codigo_autorizacion, estado, fecha_pago
    ) values (
        p_id_usuario, p_nombre_pagador, p_id_servicio, p_nombre_servicio, p_proveedor,
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
