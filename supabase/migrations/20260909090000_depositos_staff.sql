-- Depósitos en efectivo hechos por un cajero/administrador desde el portal
-- de colaboradores. El cliente NO puede depositarse dinero a sí mismo (eso
-- sería fabricar saldo desde el navegador): esta operación solo la puede
-- disparar una sesión de staff real, verificada con el JWT firmado, nunca
-- con un parámetro que el navegador declare por su cuenta.

-- 1. Se guarda qué cajero hizo el depósito, para el historial y el voucher.
--    Nullable y sin tocar filas existentes: las transacciones de cliente
--    (transferencias, pagos) simplemente no llevan este dato.
ALTER TABLE public.transacciones
    ADD COLUMN IF NOT EXISTS codigo_empleado_responsable varchar(20);

-- 2. RPC de depósito. Todo el crédito de saldo pasa por acá: el staff NO
--    tiene (ni debe tener) UPDATE directo sobre cuentas.saldo_disponible,
--    igual que el cliente tampoco lo tiene para sus propias transferencias.
CREATE OR REPLACE FUNCTION public.depositar_a_cuenta(
    p_numero_cuenta text,
    p_monto numeric,
    p_concepto text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
    v_rol text;
    v_codigo_empleado text;
    v_saldo_anterior numeric;
    v_saldo_nuevo numeric;
    v_moneda varchar;
    v_estado varchar;
    v_tipo_cuenta varchar;
    v_dpi varchar;
    v_nombres varchar;
    v_apellidos varchar;
    v_codigo_autorizacion varchar;
    v_concepto_limpio text;
begin
    -- Solo una sesión de staff real puede acreditar dinero. El rol viene del
    -- JWT firmado por Supabase Auth (app_metadata.role), no de nada que el
    -- navegador pueda declarar por su cuenta.
    v_rol := (auth.jwt() -> 'app_metadata' ->> 'role');
    if v_rol is null or v_rol not in ('Trabajador', 'Supervisor', 'Administrador') then
        raise exception 'No tienes permiso para realizar depósitos.';
    end if;

    v_codigo_empleado := (auth.jwt() -> 'app_metadata' ->> 'codigo_empleado');

    if p_monto is null or p_monto <= 0 then
        raise exception 'El monto debe ser mayor a cero.';
    end if;

    if p_monto > 100000 then
        raise exception 'El monto máximo por depósito es Q 100,000.00. Para montos mayores, divide la operación.';
    end if;

    v_concepto_limpio := nullif(trim(coalesce(p_concepto, '')), '');
    if v_concepto_limpio is null then
        v_concepto_limpio := 'Depósito en efectivo';
    end if;
    if length(v_concepto_limpio) > 120 then
        raise exception 'El concepto no puede superar los 120 caracteres.';
    end if;

    -- Se bloquea la fila destino para que dos depósitos simultáneos a la
    -- misma cuenta no se pisen (mismo patrón que las transferencias).
    select c.saldo_disponible, c.moneda, c.estado, c.tipo_cuenta, c.dpi_cliente,
           pc.nombres, pc.apellidos
    into v_saldo_anterior, v_moneda, v_estado, v_tipo_cuenta, v_dpi,
         v_nombres, v_apellidos
    from cuentas c
    join perfiles_clientes pc on pc.dpi = c.dpi_cliente
    where c.numero_cuenta = p_numero_cuenta
    for update of c;

    if not found then
        raise exception 'La cuenta % no existe.', p_numero_cuenta;
    end if;

    if v_estado <> 'Activa' then
        raise exception 'La cuenta no está activa (estado actual: %). No se puede depositar.', v_estado;
    end if;

    v_saldo_nuevo := v_saldo_anterior + p_monto;

    update cuentas
    set saldo_disponible = v_saldo_nuevo
    where numero_cuenta = p_numero_cuenta;

    v_codigo_autorizacion := 'DEP-' || floor(random() * 900000 + 100000)::text;

    insert into transacciones (
        monto, tipo_transaccion, fecha_hora, estado_transaccion,
        codigo_autorizacion, cuenta_origen, cuenta_destino,
        codigo_empleado_responsable
    ) values (
        p_monto, 'Deposito', now(), 'Completada',
        v_codigo_autorizacion, null, p_numero_cuenta,
        v_codigo_empleado
    );

    return json_build_object(
        'exito', true,
        'codigo_autorizacion', v_codigo_autorizacion,
        'numero_cuenta', p_numero_cuenta,
        'tipo_cuenta', v_tipo_cuenta,
        'moneda', v_moneda,
        'titular', trim(v_nombres || ' ' || v_apellidos),
        'dpi', v_dpi,
        'monto', p_monto,
        'concepto', v_concepto_limpio,
        'saldo_anterior', v_saldo_anterior,
        'saldo_nuevo', v_saldo_nuevo,
        'atendido_por', coalesce(v_codigo_empleado, 'N/D'),
        'fecha', now()
    );
end;
$function$;

-- Ni anon ni el público en general: solo una sesión ya autenticada, y la
-- función igual revisa el rol adentro. anon nunca debería poder ni intentar
-- llamarla (un cliente no autenticado no tiene por qué acercarse a esto).
REVOKE EXECUTE ON FUNCTION public.depositar_a_cuenta(text, numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.depositar_a_cuenta(text, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.depositar_a_cuenta(text, numeric, text) TO authenticated;
