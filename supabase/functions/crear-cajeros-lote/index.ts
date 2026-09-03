// Única pieza "backend" de todo el proyecto: crea cuentas de Supabase Auth
// para nuevo personal del banco. Necesita la service_role key (Admin API),
// que nunca puede vivir en el navegador — por eso corre como Edge Function.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DOMINIO_STAFF = 'staff.bancouvg.internal'
const CANTIDAD_MAXIMA = 50

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return jsonResponse({ error: 'No autorizado.' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    // Quién llama, y con qué rol firmado en su JWT — no confiamos en nada
    // que venga del body de la petición para autorizar esto.
    const jwt = authHeader.replace('Bearer ', '')
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(jwt)

    if (userError || !userData?.user) {
      return jsonResponse({ error: 'Sesión inválida.' }, 401)
    }

    const rol = userData.user.app_metadata?.role
    if (rol !== 'Administrador') {
      return jsonResponse({ error: 'Solo un Administrador puede crear cajeros.' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    let cantidad = parseInt(body?.cantidad, 10)
    if (!Number.isFinite(cantidad) || cantidad < 1) cantidad = 1
    if (cantidad > CANTIDAD_MAXIMA) cantidad = CANTIDAD_MAXIMA

    const creados: { codigo_empleado: string; password: string }[] = []
    const errores: string[] = []

    for (let i = 0; i < cantidad; i++) {
      const { data: codigoData, error: errCodigo } = await supabaseAdmin.rpc('siguiente_codigo_empleado')
      if (errCodigo || !codigoData) {
        errores.push(`No se pudo generar código (#${i + 1}): ${errCodigo?.message ?? 'sin código'}`)
        continue
      }

      const codigo = codigoData as string
      const password = generarPasswordSegura(12)
      const email = `${codigo}@${DOMINIO_STAFF}`

      const { data: nuevoUsuario, error: errCrear } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { role: 'Trabajador', codigo_empleado: codigo }
      })

      if (errCrear || !nuevoUsuario?.user) {
        errores.push(`${codigo}: ${errCrear?.message ?? 'error desconocido al crear el usuario'}`)
        continue
      }

      const { error: errPerfil } = await supabaseAdmin
        .from('perfiles_empleados')
        .insert([{
          codigo_empleado: codigo,
          puesto: 'Cajero',
          area: 'Operaciones',
          auth_uid: nuevoUsuario.user.id
        }])

      if (errPerfil) {
        errores.push(`${codigo}: usuario creado pero falló el perfil (${errPerfil.message})`)
        continue
      }

      creados.push({ codigo_empleado: codigo, password })
    }

    return jsonResponse({ creados, errores })

  } catch (err) {
    console.error('Error crítico en crear-cajeros-lote:', err)
    return jsonResponse({ error: 'Error interno al crear cajeros.' }, 500)
  }
})

function generarPasswordSegura(longitud: number): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const valores = new Uint32Array(longitud)
  crypto.getRandomValues(valores)
  return Array.from(valores, v => alfabeto[v % alfabeto.length]).join('')
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}
