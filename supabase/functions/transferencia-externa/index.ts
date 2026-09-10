// Transferencias que SALEN del banco: ACH (a otros bancos locales, simulados
// en el proyecto `servicios_bancos`) y SWIFT (internacionales).
//
// Vive como Edge Function porque toca DOS bases de datos distintas y eso no
// puede ser atómico: el orden es validar -> debitar acá -> abonar allá, y si
// el abono externo falla se revierte el débito local (compensación). El
// débito local se hace con la sesión del propio cliente (se reenvía su JWT),
// así la RPC sigue verificando con auth.uid() que la cuenta es suya.
import { createClient } from 'jsr:@supabase/supabase-js@2'

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

Deno.serve(async (req: Request) => {
  const corsHeaders = cors()
  const responder = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return responder({ error: 'Método no permitido.' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return responder({ error: 'No autorizado.' }, 401)

  const URL_LOCAL = Deno.env.get('SUPABASE_URL')!
  const ANON_LOCAL = Deno.env.get('SUPABASE_ANON_KEY')!
  const SRK_LOCAL = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const URL_EXTERNO = Deno.env.get('BANCOS_EXTERNOS_URL')!
  const SRK_EXTERNO = Deno.env.get('BANCOS_EXTERNOS_SERVICE_KEY')!

  // Cliente con la sesión del solicitante: la RPC de débito valida con
  // auth.uid() que la cuenta origen realmente le pertenece.
  const comoCliente = createClient(URL_LOCAL, ANON_LOCAL, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const adminLocal = createClient(URL_LOCAL, SRK_LOCAL, { auth: { persistSession: false, autoRefreshToken: false } })
  const adminExterno = createClient(URL_EXTERNO, SRK_EXTERNO, { auth: { persistSession: false, autoRefreshToken: false } })

  let codigoLocal: string | null = null

  try {
    const body = await req.json().catch(() => ({}))
    const tipo = String(body.tipo || '')            // 'ach' | 'swift'
    const cuentaOrigen = String(body.cuenta_origen || '').trim()
    const monto = Number(body.monto)
    const motivo = String(body.motivo || '').trim().slice(0, 200)

    if (!cuentaOrigen || !Number.isFinite(monto) || monto <= 0) {
      return responder({ error: 'Datos de la transferencia incompletos.' }, 400)
    }

    // ------------------------------------------------------------------
    // ACH: destino real dentro del banco externo simulado
    // ------------------------------------------------------------------
    if (tipo === 'ach') {
      const codigoBanco = String(body.codigo_banco || '').trim()
      const cuentaDestino = String(body.cuenta_destino || '').replace(/\D/g, '')
      const titularEsperado = String(body.titular_destino || '').trim()

      if (!codigoBanco || !cuentaDestino) {
        return responder({ error: 'Falta el banco o la cuenta destino.' }, 400)
      }

      const { data: banco, error: errBanco } = await adminExterno
        .from('bancos_externos').select('id_banco, nombre, activo')
        .eq('codigo', codigoBanco).maybeSingle()
      if (errBanco || !banco) return responder({ error: 'El banco destino no existe.' }, 400)
      if (!banco.activo) return responder({ error: 'El banco destino no está disponible.' }, 400)

      const { data: destino, error: errDestino } = await adminExterno
        .from('cuentas_externas')
        .select('id_cuenta_externa, titular, saldo, moneda, estado')
        .eq('id_banco', banco.id_banco).eq('numero_cuenta', cuentaDestino).maybeSingle()

      if (errDestino || !destino) {
        return responder({ error: `La cuenta ${cuentaDestino} no existe en ${banco.nombre}.` }, 400)
      }
      if (destino.estado !== 'Activa') {
        return responder({ error: 'La cuenta destino no está activa.' }, 400)
      }

      // Débito local (valida dueño, estado y saldo dentro de la RPC)
      const { data: debito, error: errDebito } = await comoCliente.rpc('debitar_transferencia_externa', {
        p_cuenta_origen: cuentaOrigen,
        p_monto: monto,
        p_tipo: 'Transferencia ACH',
        p_referencia_destino: `${banco.nombre} / ${cuentaDestino}`,
      })
      if (errDebito) return responder({ error: errDebito.message }, 400)
      codigoLocal = (debito as { codigo_autorizacion: string }).codigo_autorizacion

      // Abono en el banco externo + bitácora ACH
      const { error: errAbono } = await adminExterno
        .from('cuentas_externas')
        .update({ saldo: Number(destino.saldo) + monto })
        .eq('id_cuenta_externa', destino.id_cuenta_externa)

      if (errAbono) {
        await adminLocal.rpc('revertir_transferencia_externa', { p_codigo: codigoLocal })
        return responder({ error: 'No se pudo acreditar en el banco destino. La transferencia fue revertida.' }, 502)
      }

      await adminExterno.from('transacciones_ach').insert({
        id_banco_destino: banco.id_banco,
        cuenta_origen: cuentaOrigen,
        cuenta_destino: cuentaDestino,
        titular_destino: destino.titular,
        monto,
        moneda: destino.moneda || 'GTQ',
        motivo: motivo || 'Transferencia ACH',
        estado: 'Completada',
      })

      return responder({
        exito: true,
        codigo_autorizacion: codigoLocal,
        banco_destino: banco.nombre,
        titular_destino: destino.titular,
        titular_coincide: !titularEsperado || destino.titular.toLowerCase().includes(titularEsperado.toLowerCase().split(' ')[0]),
        monto,
      })
    }

    // ------------------------------------------------------------------
    // SWIFT: no hay banco corresponsal simulado, así que se registra la
    // salida de fondos con su código SWIFT y beneficiario, sin abono
    // externo. Es una simulación honesta: el dinero sale del banco.
    // ------------------------------------------------------------------
    if (tipo === 'swift') {
      const codigoSwift = String(body.codigo_swift || '').trim().toUpperCase()
      const beneficiario = String(body.beneficiario || '').trim()

      if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(codigoSwift)) {
        return responder({ error: 'El código SWIFT/BIC no tiene un formato válido (8 u 11 caracteres).' }, 400)
      }
      if (!beneficiario) return responder({ error: 'Falta el nombre del beneficiario.' }, 400)

      const { data: debito, error: errDebito } = await comoCliente.rpc('debitar_transferencia_externa', {
        p_cuenta_origen: cuentaOrigen,
        p_monto: monto,
        p_tipo: 'Transferencia Internacional',
        p_referencia_destino: `${codigoSwift} / ${beneficiario}`,
      })
      if (errDebito) return responder({ error: errDebito.message }, 400)

      return responder({
        exito: true,
        codigo_autorizacion: (debito as { codigo_autorizacion: string }).codigo_autorizacion,
        codigo_swift: codigoSwift,
        beneficiario,
        monto,
      })
    }

    return responder({ error: 'Tipo de transferencia no reconocido.' }, 400)

  } catch (error) {
    console.error('Error en transferencia-externa:', error)
    if (codigoLocal) {
      await adminLocal.rpc('revertir_transferencia_externa', { p_codigo: codigoLocal }).catch(() => {})
    }
    return responder({ error: 'Error interno al procesar la transferencia.' }, 500)
  }
})
