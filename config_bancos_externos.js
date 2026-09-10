// Catálogo de bancos externos (proyecto `servicios_bancos`): solo se usa para
// LEER la lista de bancos locales disponibles para ACH. El movimiento de
// dinero nunca pasa por acá -- eso lo hace la Edge Function
// `transferencia-externa` con credenciales de servidor.
//
// Nombre distinto a CONFIG a propósito: config.example.js ya declara CONFIG
// para el proyecto principal y cargar ambos rompería la página.
const CONFIG_BANCOS_EXTERNOS = {
    URL_DE_SUPABASE: "https://ziorxlualqoyphirbxrr.supabase.co",
    KEY_ANON_SUPABASE: "sb_publishable_OQZb2O0uiQj_MwcZg5W-rw_6h-PMYBg"
};
