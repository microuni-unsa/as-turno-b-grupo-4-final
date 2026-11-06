# @unsareport/standard-report

Plantilla estándar para informes académicos de la UNSA. Incluye portada institucional oficial, numeración y sangría jerárquica automática, formato de tablas y figuras, y renombrado post-compilación.

## Uso

```typst
#import "/components/@unsareport/standard-report/lib.typ": standard-report, no-indent-block, force-indent-block

#show: standard-report.with(
  pretitle: "ACTIVIDAD PRÁCTICA",
  title: [DOCUMENTACIÓN TÉCNICA DEL PROYECTO],
  course: "GESTIÓN DE PROYECTOS DE SOFTWARE",
  group: "TURNO A - GRUPO 1",
  teacher: "MG. DOCENTE DEL CURSO",
  activity_code: "T1",
  authors: (
    "Integrante 1",
    "Integrante 2",
    "Integrante 3",
  ),
)

= Introducción
Contenido del informe...
```

## Parámetros de `standard-report`

- `pretitle`: Etiqueta superior o tipo de actividad (ej. `"ACTIVIDAD PRÁCTICA"`).
- `title`: Título principal del documento.
- `course`: Nombre de la asignatura.
- `group`: Grupo o turno de clases.
- `teacher`: Nombre del docente.
- `activity_code`: Código identificador de la actividad (ej. `"T1"`).
- `authors`: Lista con los nombres de los autores (o un solo nombre en texto).
- `custom_variables`: Diccionario con variables adicionales para el renombrado del archivo.

## Funciones adicionales

- `no-indent-block(body)`: Desactiva la sangría automática en el bloque indicado.
- `force-indent-block(body)`: Fuerza la sangría automática en el bloque indicado.
- `define`, `get-var`, `get-all-vars`: Funciones para registrar y consultar metadatos (re-exportadas de `@unsareport/define`).

## Configuración de renombrado

El paquete renombra automáticamente el PDF compilado según el formato configurado en `unsareport.toml`:

```toml
[config-schema.filename_format]
default = "{course} - {activity_code} - {group} - Informe.pdf"
```

Variables disponibles: `{course}`, `{activity_code}`, `{group}`, `{pretitle}`, `{title}`, `{teacher}`, `{authors}`, `{year}`, `{faculty}`, `{school}`, `{university}`, `{city_country}`.
