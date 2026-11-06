# @unsareport/gdocs-code-block

Bloque de código estilizado similar a Google Docs para Typst, con soporte para extracción de fragmentos delimitados en el archivo fuente.

## Uso

```typst
#import "/components/@unsareport/gdocs-code-block/lib.typ": code-block

// Bloque de código directo
#code-block("print('Hola mundo')", lang: "python")

// Extraer un fragmento específico desde un archivo externo
#code-block(
  read("main.py"),
  snippet: "demo",
  lang: "python",
)
```

Para marcar fragmentos dentro del archivo fuente:

```python
# // START-SNIPPET,demo
print("Este fragmento será extraído")
# // END-SNIPPET
```

## Parámetros de `code-block`

- `source`: Contenido del código fuente en texto plano.
- `snippet`: Nombre del fragmento a extraer (por defecto: `none`, muestra todo el código).
- `prefix`: Prefijo de comentario usado en los delimitadores (por defecto: `"//"`).
- `lang`: Lenguaje para el resaltado de sintaxis (por defecto: `"text"`).
- `fill`: Color de fondo del bloque (por defecto: `rgb("#F1F3F4")`).
- `inset`: Margen interno del contenedor (por defecto: `1em`).
- `radius`: Radio de las esquinas redondeadas (por defecto: `8pt`).
- `spacing`: Espaciado vertical antes y después del bloque (por defecto: `0.65em`).
- `text-size`: Tamaño de la fuente del código (por defecto: `7pt`).
- `breakable`: Permite dividir el bloque entre páginas (por defecto: `true`).

## Funciones adicionales

- `extract-named-snippet(source, snippet-name, prefix: "//")`: Retorna el texto del fragmento delimitado en el código fuente.
