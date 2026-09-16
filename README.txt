MULTIGESTIÓN MR V1.2.1

CORRECCIÓN V1.2.1

Cambios principales:
1. Memoria inteligente corregida: la lista se abre junto al campo y ya no debe desplazar la página al inicio.
2. La lista se filtra escribiendo directamente en el mismo campo; no abre una ventana modal.
3. Excel simplificado a UNA SOLA HOJA / UN SOLO CUADRO por negocio.
4. Encabezado superior: MULTIGESTIÓN MR, nombre del negocio, actividad, período y fecha de emisión.
5. Columnas: N.º, FECHA, TIPO, CATEGORÍA, CONCEPTO, CANTIDAD, UNIDAD, TOTAL y PAGO.
6. Encabezados en MAYÚSCULA, NEGRITA y con color de fondo.
7. Diferenciación visual de INGRESOS/VENTAS y GASTOS/COMPRAS, además de TOTAL y PAGO.
8. Totales finales de INGRESOS, GASTOS y RESULTADO.
9. Logo MULTIGESTIÓN MR como marca de agua transparente repetida para impresión.
10. El archivo .xlsx queda EDITABLE; no se protegen las celdas.
11. Mantiene la misma base de datos multigestion_mr_v1 para conservar registros existentes.
12. Caché actualizado a V1.2.1.

AL SUBIR A GITHUB PAGES:
- Reemplace TODOS los archivos anteriores por los de esta carpeta.
- Confirme que la insignia superior muestre V1.2.1.


MULTIGESTIÓN MR V1.3 - ACCESO COMPARTIDO
-----------------------------------------
- Integración Supabase con Publishable key (nunca Secret key).
- Modo local conservado como respaldo.
- Administrador con sesión de correo/contraseña.
- Colaborador por enlace privado y sesión anónima de Supabase.
- El colaborador puede agregar y editar solo sus propios movimientos.
- Solo administrador elimina movimientos/negocios y genera/revoca enlaces.
- Migración de datos locales a nube desde la propia aplicación.
- Auditoría conservada en Supabase.
- Corrección adicional de ancho de impresión Excel para evitar división lateral.

ANTES DE USAR ENLACES:
1) Ejecutar SUPABASE_PATCH_V1.3.sql en SQL Editor.
2) En Supabase > Authentication, habilitar Anonymous Sign-Ins.
3) Publicar esta versión en GitHub Pages.
