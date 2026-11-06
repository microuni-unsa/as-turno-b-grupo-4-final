# @unsareport/define

Utilidad para definir variables de metadatos en documentos Typst y consultarlas tanto dentro de Typst como desde scripts externos en Bun.

## Uso

### En Typst

```typst
#import "/components/@unsareport/define/lib.typ": define, get-var, get-all-vars

// Registrar variables
#define("course_abbr", "CAS")
#define("lab_number", "01")

// Leer variables
#context [
  Curso: #get-var("course_abbr") \
  Opcional con valor por defecto: #get-var("seccion", default: "A")
]
```

### En scripts externos (Bun)

```ts
import { readVars } from "@unsareport/define/scripts/read-vars.ts";

const vars = await readVars(rootDir, entryFile);
// { course_abbr: "CAS", lab_number: "01" }
```

## Funciones exportadas

### Typst (`lib.typ`)
- `define(name, value)`: Registra una variable de metadatos.
- `get-var(name, default: none)`: Obtiene el valor de una variable. Si no existe y no tiene valor por defecto, genera un error.
- `get-all-vars()`: Retorna un diccionario con todas las variables registradas.

### TypeScript (`scripts/read-vars.ts`)
- `readVars(rootDir, entryFile)`: Función asíncrona que extrae las variables exportadas por el documento Typst ejecutando `typst eval`.
