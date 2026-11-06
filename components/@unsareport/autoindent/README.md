# @unsareport/autoindent

Motor de sangría jerárquica contextual para Typst. Aplica sangría automática a párrafos, listas, tablas, figuras y bloques de código según el nivel del encabezado activo.

## Uso

```typst
#import "/components/@unsareport/autoindent/lib.typ": autoindent, no-indent-block, force-indent-block

// Activar la sangría automática en el documento
#show: autoindent
```

También es posible personalizar las dimensiones:

```typst
#show: autoindent.with(
  indent-width: 14pt,
  num-gutter: 0.8em,
  include-heading: true,
)
```

### Bloques de escape

Permiten ignorar o forzar la sangría en bloques específicos:

```typst
#no-indent-block[
  Este párrafo no tendrá sangría.
]

#force-indent-block[
  Este párrafo tendrá sangría sin importar su ubicación.
]
```

## Parámetros

- `indent-width`: Ancho de sangría añadido por cada nivel jerárquico (por defecto: `12pt`).
- `num-gutter`: Espacio entre el número y el texto del encabezado (por defecto: `0.6em`).
- `include-heading`: Aplica sangría también al propio encabezado (por defecto: `false`).
- `indent-level-offset`: Nivel inicial a partir del cual se calcula la sangría (por defecto: `1`).
- `force-level`: Nivel de sangría aplicado en `force-indent-block` (por defecto: `1`).
