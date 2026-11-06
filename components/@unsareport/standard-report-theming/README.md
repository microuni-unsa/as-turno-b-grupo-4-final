# @unsareport/standard-report-theming

Tokens de diseño y variables de estilo para informes estándar de la UNSA. Define la tipografía, márgenes, espaciado de párrafos, encabezados y estilos de tablas.

## Uso

```typst
#import "/components/@unsareport/standard-report-theming/lib.typ": *

// Sobrescribir variables de estilo si es necesario
#let font-size = 11pt
```

## Variables disponibles

- **Tipografía**: `font-family`, `font-size`, `font-lang`, `font-hyphenate`.
- **Geometría de página**: `page-paper`, `cover-margin`, `body-margin`, `page-numbering`, `page-number-align`.
- **Espaciado y párrafos**: `par-justify`, `par-first-line-indent`, `par-spacing`, `par-leading`, `cover-par-leading`.
- **Encabezados y título**: `heading-font-size`, `heading-weight`, `heading-space-above`, `heading-space-below`, `title-text-size`, `title-weight`, `title-space-below`.
- **Sangría jerárquica**: `indent-width`, `num-gutter`.
- **Tablas**: `table-header-fill`, `table-cell-stroke`, `table-text-size`, `table-header-weight`.
- **Institucional**: `cover-logo-width`, `faculty`, `school`.
