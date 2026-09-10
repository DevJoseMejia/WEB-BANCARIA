-- La migración de hardening reemplazó el SELECT general de usuarios por
-- permisos a columnas concretas. auth_uid se agregó después, pero no se
-- otorgó SELECT sobre ella. PostgREST necesita leerla para evaluar
-- `.eq('auth_uid', session.user.id)`, incluso si no se devuelve al cliente.
GRANT SELECT (auth_uid) ON public.usuarios TO authenticated;

