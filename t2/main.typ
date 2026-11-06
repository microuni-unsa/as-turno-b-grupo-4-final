#import "/components/@unsareport/standard-report/lib.typ": standard-report

#show: standard-report.with(
  pretitle: "ACTIVIDAD PRÁCTICA",
  title: [TRABAJO DE INVESTIGACIÓN FORMATIVA: SISTEMA DE SOPORTE A SISTEMA DE GESTIÓN DE INFORMACIÓN DE PRIVACIDAD, PIMS, SEGÚN ISO/IEC 27701],
  course: "AUDITORÍA DE SISTEMAS",
  group: "GRUPO 4",
  teacher: "EDWARD VICENTE ZARATE CARLOS",
  activity_code: "T2",
  authors: (
    "JHOSSEP FABRITZIO VELARDE SALDAÑA",
    "JOHANN ANDRE CACERES RUIZ",
    "CHRISTIAN RAUL MESTAS ZEGARRA",
    "MARIEL ALISSON JARA MAMANI",
  ),
)

#set text(size: 10pt)

#table(
  columns: (2.2fr, 4.8fr),
  stroke: 0.5pt + rgb("#b0bec5"),
  inset: (x: 7pt, y: 4.4pt),
  fill: (col, row) => if row == 0 { rgb("#1d3557") } else if calc.even(row) { rgb("#f8fafc") } else { rgb("#ffffff") },

  table.header(
    text(weight: "bold", fill: white)[Parámetro],
    text(weight: "bold", fill: white)[Detalle y especificación técnica],
  ),

  [ Turno ],
  [ B ],

  [ Grupo ],
  [ 4 ],

  [ Nombre del agente ],
  [ Agente de incidentes ],

  [ Cláusulas y controles de ISO/IEC 27701:2025 aplicables al manejo de incidencias y cobertura del sistema ],
  [
    La cobertura del sistema abarca los requisitos de gestión de incidentes de la norma ISO/IEC 27701:2025:

    - Cláusula 5.3: Roles, responsabilidades y autoridades. Asigna funciones diferenciadas de triaje, investigación, revisión, fiscalización legal y notificación con permisos limitados a las herramientas necesarias y registro inmutable de acciones.
    - Cláusulas 6.1.2 y 8.2: Evaluación de riesgos de privacidad. Evalúa el impacto sobre los titulares de datos personales, califica la severidad del evento e identifica categorías afectadas como documentos de identidad, datos biométricos o credenciales.
    - Cláusulas 6.1.3 y 8.3: Tratamiento de riesgos de privacidad. Aplica medidas de contención técnica, aislamiento de servicios y salvaguardas inmediatas.
    - Cláusula 7.5: Información documentada. Resguarda las evidencias en un repositorio cifrado en reposo con AES-256-GCM, cadenas de comprobación con SHA-256 y sellado canónico de registros en PostgreSQL.
    - Cláusula 9.1: Seguimiento, medición, análisis y evaluación. Mantiene un servicio supervisor continuo, una cuenta regresiva de setenta y dos horas para obligaciones de notificación y verificación de estado operativo.
    - Cláusula 10.2: No conformidad y acción correctiva. Formula análisis de causa raíz, propone acciones preventivas y ejecuta una lista de comprobación de ocho puntos previa al cierre.
    - Control A.3.11 y B.3.11: Planificación y preparación de la gestión de incidentes. Recibe incidentes desde la interfaz de programación de aplicaciones del sistema de gestión y filtra datos personales de manera estricta antes de cualquier análisis automatizado externo.
    - Control A.3.12 y B.3.12: Respuesta a incidentes de seguridad de la información. Confirma la existencia de una brecha, redacta los informes requeridos por el artículo 33 del Reglamento General de Protección de Datos, GDPR, elabora comunicaciones para titulares en lenguaje accesible conforme al artículo 34 y analiza las condiciones de exención previstas en el artículo 34 inciso 3.
  ],

  [ Enlace del sistema ],
  [
    https://incidents-pims.mistercricro8.top
  ],

  [ Credenciales de acceso ],
  [
    Usuario: grupob4 \
    Contraseña: #text("Q^*aLefm8gyBf3N^")
  ],

  [ Enlace a video de demostración del sistema ],
  [
    https://drive.google.com/file/d/1s2bho-8cZCJjZSwx_PA_l8MGUzojRzmI/view?usp=sharing
  ],
)

#set page(flipped: true)

#figure(
  image("img/architecture-ai.png", width: 95%),
  caption: [Arquitectura Cognitiva, Orquestación Multi-Rol y Flujo de IA],
)

#figure(
  image("img/architecture-system.png", width: 98%),
  caption: [Arquitectura Integral del Sistema e Infraestructura],
)
