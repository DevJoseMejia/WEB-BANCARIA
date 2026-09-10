import { createClient } from 'jsr:@supabase/supabase-js@2'

const ORIGENES_PERMITIDOS = new Set([
  'http://localhost:5500', 'http://127.0.0.1:5500',
  'http://localhost:8765', 'http://127.0.0.1:8765',
])

function cors(origin: string | null) {
  const permitido = origin && ORIGENES_PERMITIDOS.has(origin) ? origin : 'http://127.0.0.1:5500'
  return {
    'Access-Control-Allow-Origin': permitido,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  }
}

const ROLES_STAFF = ['Trabajador', 'Supervisor', 'Administrador']

Deno.serve(async (req: Request) => {
  const corsHeaders = cors(req.headers.get('Origin'))
  const responder = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return responder({ error: 'Método no permitido.' }, 405)

  let authUidCreado: string | null = null
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return responder({ error: 'No autorizado.' }, 401)
    const { data: caller, error: callerError } = await admin.auth.getUser(authHeader.replace('Bearer ', ''))
    const rolStaff = caller.user?.app_metadata?.role
    if (callerError || !caller.user || !ROLES_STAFF.includes(rolStaff)) {
      return responder({ error: 'La sesión no pertenece a un colaborador autorizado.' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const nombres = String(body.nombres || '').trim()
    const apellidos = String(body.apellidos || '').trim()
    const dpi = String(body.dpi || '').replace(/\D/g, '')
    const telefono = String(body.telefono || '').trim()
    const correo = String(body.correo || '').trim().toLowerCase()
    const direccion = String(body.direccion || '').trim()
    const fechaNacimiento = String(body.fecha_nacimiento || '')
    let username = String(body.username || '').trim().toLowerCase()

    if (!nombres || !apellidos || dpi.length !== 13 || !/^\+502\d{8}$/.test(telefono) ||
        !correo.includes('@') || !direccion || !fechaNacimiento || !username) {
      return responder({ error: 'Los datos del cliente están incompletos o tienen formato inválido.' }, 400)
    }

    const [{ data: correoExistente }, { data: usuarioExistente }] = await Promise.all([
      admin.from('usuarios').select('id_usuario').eq('email', correo).maybeSingle(),
      admin.from('usuarios').select('id_usuario').eq('username', username).maybeSingle(),
    ])
    if (correoExistente || usuarioExistente) return responder({ error: 'El correo o usuario ya está registrado.' }, 409)
    const { data: dpiExistente } = await admin.from('perfiles_clientes').select('dpi').eq('dpi', dpi).maybeSingle()
    if (dpiExistente) return responder({ error: 'Ya existe un cliente registrado con ese DPI.' }, 409)

    const { data: rolCliente, error: errRol } = await admin.from('roles')
      .select('id_rol').eq('nombre_rol', 'Cliente').maybeSingle()
    if (errRol || !rolCliente) throw new Error("No se encontró el rol 'Cliente'.")

    const password = generarPasswordSegura(12)
    const { data: authCreado, error: errAuth } = await admin.auth.admin.createUser({
      email: correo, password, email_confirm: true, app_metadata: { role: 'Cliente' },
    })
    if (errAuth || !authCreado.user) return responder({ error: errAuth?.message || 'No se pudo crear el acceso.' }, 400)
    authUidCreado = authCreado.user.id

    const { data: usuario, error: errUsuario } = await admin.from('usuarios').insert({
      username, email: correo, auth_uid: authUidCreado, estado_cuenta: 'Activa',
      intentos_fallidos: 0, requiere_mfa: false, id_rol: rolCliente.id_rol,
    }).select('id_usuario').single()
    if (errUsuario || !usuario) throw new Error(errUsuario?.message || 'No se pudo crear el usuario bancario.')

    const { error: errPerfil } = await admin.from('perfiles_clientes').insert({
      dpi, nombres, apellidos, telefono, direccion, fecha_nacimiento: fechaNacimiento,
      id_usuario: usuario.id_usuario,
    })
    if (errPerfil) throw new Error(errPerfil.message)

    let numeroCuenta = ''
    for (let intento = 0; intento < 5 && !numeroCuenta; intento++) {
      const candidato = `40${numerosAleatorios(9)}`
      const { error } = await admin.from('cuentas').insert({
        numero_cuenta: candidato, tipo_cuenta: 'Monetaria', saldo_disponible: 0,
        saldo_retenido: 0, moneda: 'GTQ', estado: 'Activa', dpi_cliente: dpi,
      })
      if (!error) numeroCuenta = candidato
      else if (error.code !== '23505') throw new Error(error.message)
    }
    if (!numeroCuenta) throw new Error('No se pudo asignar un número de cuenta.')

    return responder({ username, password, numero_cuenta: numeroCuenta })
  } catch (error) {
    console.error('Error al crear cliente:', error)
    if (authUidCreado) await admin.auth.admin.deleteUser(authUidCreado)
    return responder({ error: error instanceof Error ? error.message : 'Error interno.' }, 500)
  }
})

function generarPasswordSegura(longitud: number) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const valores = new Uint32Array(longitud); crypto.getRandomValues(valores)
  return Array.from(valores, v => chars[v % chars.length]).join('')
}

function numerosAleatorios(longitud: number) {
  const valores = new Uint32Array(longitud); crypto.getRandomValues(valores)
  return Array.from(valores, v => String(v % 10)).join('')
}
