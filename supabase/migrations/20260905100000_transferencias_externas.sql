-- Soporte para transferencias que salen del banco: ACH (a otros bancos
-- locales, simulados en el proyecto `servicios_bancos`) y SWIFT
-- (internacionales). El débito local siempre pasa por estas RPCs, que
-- verifican al dueño real con auth.uid() igual que la transferencia interna.

-- 1. `transacciones` necesita aceptar el tipo internacional
-- El esquema original ya traía esta restricción con el nombre chk_tipo_tx;
-- se reemplaza esa misma (no se crea una segunda, porque TODAS las CHECK de
-- una tabla deben pasar y una duplicada con lista distinta bloquearía el
-- tipo nuevo).
ALTER TABLE public.transacciones DROP CONSTRAINT IF EXISTS chk_tipo_tx;
ALTER TABLE public.transacciones ADD CONSTRAINT chk_tipo_tx
    CHECK (tipo_transaccion::text = ANY (ARRAY[
        'Transferencia Interna'::text,
        'Transferencia ACH'::text,
        'Transferencia Internacional'::text,
        'Pago de Servicio'::text,
        'Deposito'::text,
        'Retiro'::text
    ]));

-- 2. Débito para una transferencia que sale del banco.
--    `cuenta_destino` queda en NULL a propósito: la cuenta receptora no
--    existe en este banco, así que la FK no la aceptaría. El destino real
--    queda registrado en la referencia y (para ACH) en transacciones_ach
--    del proyecto externo.
CREATE OR REPLACE FUNCTION public.debitar_transferencia_externa(
    p_cuenta_origen text,
    p_monto numeric,
    p_tipo text,
    p_referencia_destino text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
    v_id_usuario_actual uuid;
    v_saldo numeric;
    v_moneda varchar;
    v_estado varchar;
    v_dueno uuid;
    v_codigo varchar;
begin
    if p_tipo not in ('Transferencia ACH', 'Transferencia Internacional') then
        raise exception 'Tipo de transferencia externa no válido';
    end if;

    select id_usuario into v_id_usuario_actual from usuarios where auth_uid = auth.uid();
    if v_id_usuario_actual is null then
        raise exception 'No se pudo identificar tu sesión.';
    end if;

    if p_monto is null or p_monto <= 0 then
        raise exception 'El monto debe ser mayor a cero';
    end if;

    select c.saldo_disponible, c.moneda, c.estado, pc.id_usuario
    into v_saldo, v_moneda, v_estado, v_dueno
    from cuentas c
    join perfiles_clientes pc on pc.dpi = c.dpi_cliente
    where c.numero_cuenta = p_cuenta_origen
    for update of c;

    if not found then
        raise exception 'La cuenta origen no existe';
    end if;

    if v_dueno is distinct from v_id_usuario_actual then
        raise exception 'No tienes permiso para operar sobre esta cuenta';
    end if;

    if v_estado <> 'Activa' then
        raise exception 'La cuenta origen no está activa';
    end if;

    if v_saldo < p_monto then
        raise exception 'Saldo insuficiente en la cuenta origen';
    end if;

    update cuentas set saldo_disponible = saldo_disponible - p_monto
    where numero_cuenta = p_cuenta_origen;

    v_codigo := case when p_tipo = 'Transferencia ACH' then 'ACH-' else 'SWF-' end
                || floor(random() * 900000 + 100000)::text;

    insert into transacciones (
        monto, tipo_transaccion, fecha_hora, estado_transaccion,
        codigo_autorizacion, cuenta_origen, cuenta_destino
    ) values (
        p_monto, p_tipo, now(), 'Completada',
        v_codigo, p_cuenta_origen, null
    );

    return json_build_object(
        'exito', true,
        'codigo_autorizacion', v_codigo,
        'monto', p_monto,
        'moneda', v_moneda,
        'referencia_destino', p_referencia_destino
    );
end;
$function$;

-- 3. Compensación: si el abono en el banco externo falla después de haber
--    debitado acá, se devuelve el dinero y la transacción queda marcada
--    'Revertida' (no se borra: el historial debe reflejar lo que pasó).
CREATE OR REPLACE FUNCTION public.revertir_transferencia_externa(p_codigo text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
    v_tx record;
begin
    select * into v_tx from transacciones
    where codigo_autorizacion = p_codigo and estado_transaccion = 'Completada'
    for update;

    if not found then
        return json_build_object('exito', false, 'motivo', 'Transacción no encontrada o ya revertida');
    end if;

    update cuentas set saldo_disponible = saldo_disponible + v_tx.monto
    where numero_cuenta = v_tx.cuenta_origen;

    update transacciones set estado_transaccion = 'Revertida'
    where codigo_autorizacion = p_codigo;

    return json_build_object('exito', true, 'monto_devuelto', v_tx.monto);
end;
$function$;

-- Solo la Edge Function (service_role) puede revertir; ningún cliente.
REVOKE EXECUTE ON FUNCTION public.revertir_transferencia_externa(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revertir_transferencia_externa(text) TO service_role;
