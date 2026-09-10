-- BUG REAL EN PRODUCCIÓN: solicitar_cuenta.js, prestamos.js y tarjetas.js
-- insertan solicitudes sin pedir la fila de vuelta explícitamente, así que
-- supabase-js no manda "Prefer: return=minimal" -- y el default de
-- PostgREST es "return=representation". Sin una política de SELECT para
-- anon, Postgres no puede devolver la fila recién insertada y el INSERT
-- completo falla con "new row violates row-level security policy",
-- aunque la política de INSERT en sí esté perfectamente bien.
--
-- Se agrega SELECT abierto para anon en las 3 tablas de solicitudes,
-- exactamente el mismo criterio que ya usan usuarios/perfiles_clientes/
-- cuentas/producto_tarjetas en este proyecto (lectura pública con anon key,
-- sin Supabase Auth propio para clientes). Sigue pendiente para la Fase 4
-- de seguridad, junto con el resto de esas tablas.

CREATE POLICY "select_publico_solicitudes_cuentas" ON public.solicitudes_cuentas
    FOR SELECT USING (true);

CREATE POLICY "select_publico_solicitudes_prestamos" ON public.solicitudes_prestamos
    FOR SELECT USING (true);

CREATE POLICY "select_publico_solicitudes_productos" ON public.solicitudes_productos
    FOR SELECT USING (true);
