#import "/components/@unsareport/standard-report-theming/lib.typ": *
#import "/components/@unsareport/define/lib.typ": define, get-var, get-all-vars

#import "/components/@unsareport/autoindent/lib.typ": *

#let VAR-TITLE = "title"
#let VAR-PRETITLE = "pretitle"
#let VAR-COURSE = "course"
#let VAR-GROUP = "group"
#let VAR-TEACHER = "teacher"
#let VAR-ACTIVITY-CODE = "activity_code"
#let VAR-AUTHORS = "authors"
#let VAR-YEAR = "year"
#let VAR-UNIVERSITY = "university"
#let VAR-FACULTY = "faculty"
#let VAR-SCHOOL = "school"
#let VAR-CITY-COUNTRY = "city_country"

#let INSTITUTION-UNIVERSITY = "UNIVERSIDAD NACIONAL DE SAN AGUSTÍN"
#let INSTITUTION-CITY-COUNTRY = "AREQUIPA - PERÚ"
#let DEFAULT-LOGO-PATH = "img/logo.png"

#let COVER-LABEL-COURSE = "ASIGNATURA"
#let COVER-LABEL-TEACHER = "DOCENTE"
#let COVER-LABEL-AUTHORS-MULTIPLE = "INTEGRANTES"
#let COVER-LABEL-AUTHORS-SINGLE = "PRESENTADO POR"

#let PLACEHOLDER-PRETITLE = "INGRESE PRETITULO"
#let PLACEHOLDER-TITLE = "INGRESE TITULO"
#let PLACEHOLDER-COURSE = "INGRESE CURSO"
#let PLACEHOLDER-GROUP = "INGRESE GRUPO"
#let PLACEHOLDER-TEACHER = "INGRESE DOCENTE"
#let PLACEHOLDER-ACTIVITY-CODE = "INGRESE CODIGO DE ACTIVIDAD"
#let PLACEHOLDER-AUTHORS = ("INGRESE AUTORES",)

#let FIGURE-SPACE-BELOW = 1.5em
#let TABLE-HEADER-ROW-INDEX = 0



#let to-string(it) = {
  if type(it) == str {
    it
  } else if type(it) == content {
    let f = it.fields()
    if "text" in f {
      f.text
    } else if "children" in f {
      f.children.map(to-string).join("")
    } else if "body" in f {
      to-string(f.body)
    } else if it.func() == [ ].func() {
      " "
    } else {
      ""
    }
  } else {
    ""
  }
}



#let apply-typography-rules(doc) = {
  set text(
    font: font-family,
    size: font-size,
    hyphenate: font-hyphenate,
    lang: font-lang,
  )
  set par(
    justify: par-justify,
    first-line-indent: par-first-line-indent,
    spacing: par-spacing,
    leading: par-leading,
  )
  doc
}

#let apply-heading-rules(doc) = {
  set heading(numbering: (..nums) => {
    let vals = nums.pos()
    let pattern = range(vals.len()).map(_ => "1").join(".") + "."
    numbering(pattern, ..vals)
  })
  show heading: set text(size: heading-font-size, weight: heading-weight)
  show heading: set block(above: heading-space-above, below: heading-space-below)
  show heading: it => indent-heading(
    it,
    indent-width: indent-width,
    num-gutter: num-gutter,
    indent-level-offset: INDENT-LEVEL-OFFSET,
  )
  doc
}

#let apply-indentation-rules(doc) = autoindent(
  doc,
  indent-width: indent-width,
  num-gutter: num-gutter,
  indent-level-offset: INDENT-LEVEL-OFFSET,
  force-level: FORCE-INDENT-DEFAULT-LEVEL,
  include-heading: false,
)

#let apply-table-figure-rules(doc) = {
  show figure: it => block(below: FIGURE-SPACE-BELOW)[#it]
  show figure.caption: emph
  show figure.where(kind: table): set block(breakable: true)
  set table.cell(breakable: false)
  show figure.where(kind: table): set text(size: table-text-size)
  show figure.caption.where(kind: table): set text(size: font-size)
  show table.cell.where(y: TABLE-HEADER-ROW-INDEX): set text(weight: table-header-weight)
  set table(
    fill: (col, row) => if row == TABLE-HEADER-ROW-INDEX { table-header-fill } else { none },
    stroke: (x, y) => table-cell-stroke,
  )
  doc
}


#let is-empty-value(val) = {
  if val == none {
    true
  } else if type(val) == str {
    val.trim() == ""
  } else if type(val) == array {
    val.len() == 0
  } else if type(val) == content {
    to-string(val).trim() == ""
  } else {
    false
  }
}

#let resolve-authors(authors) = {
  if is-empty-value(authors) {
    PLACEHOLDER-AUTHORS
  } else if type(authors) == array {
    authors
  } else if type(authors) == str {
    (authors,)
  } else {
    (to-string(authors),)
  }
}

#let register-document-metadata(
  title: "",
  pretitle: "",
  course: "",
  group: "",
  teacher: "",
  activity-code: "",
  authors: (),
  year: "",
  faculty: "",
  school: "",
  custom-variables: (:),
) = {
  define(VAR-TITLE, title)
  define(VAR-PRETITLE, pretitle)
  define(VAR-COURSE, course)
  define(VAR-GROUP, group)
  define(VAR-TEACHER, teacher)
  define(VAR-ACTIVITY-CODE, activity-code)
  define(VAR-AUTHORS, authors)
  define(VAR-YEAR, year)
  define(VAR-UNIVERSITY, INSTITUTION-UNIVERSITY)
  define(VAR-FACULTY, faculty)
  define(VAR-SCHOOL, school)
  define(VAR-CITY-COUNTRY, INSTITUTION-CITY-COUNTRY)

  for (name, val) in custom-variables {
    define(name, val)
  }
}

#let render-cover-page(
  pretitle: "",
  title: "",
  course: "",
  group: "",
  teacher: "",
  authors: (),
  label-authors: COVER-LABEL-AUTHORS-SINGLE,
  faculty: "",
  school: "",
  year: "",
) = {
  align(center)[
    #set par(leading: cover-par-leading)
    #strong[#INSTITUTION-UNIVERSITY]\
    #strong[#faculty]\
    #strong[#school]\ \

    #image(DEFAULT-LOGO-PATH, width: cover-logo-width)\ \

    #strong[#pretitle]\
    #title\ \

    #strong[#COVER-LABEL-COURSE]\
    #course\
    #group\ \

    #strong[#COVER-LABEL-TEACHER]\
    #teacher\ \

    #strong[#label-authors]\
    #if type(authors) == array {
      authors.join("\n")
    } else {
      authors
    }\
    \

    #strong[#INSTITUTION-CITY-COUNTRY]\
    #strong[#year]
  ]
}

#let render-body-title(title) = {
  align(center)[
    #set text(size: title-text-size, weight: title-weight)
    #block(below: title-space-below)[#title]
  ]
}

#let standard-report(
  pretitle: none,
  title: none,
  course: none,
  group: none,
  teacher: none,
  activity_code: none,
  authors: none,
  custom_variables: (:),
  doc,
) = {
  let resolved-pretitle = if is-empty-value(pretitle) { PLACEHOLDER-PRETITLE } else { pretitle }
  let resolved-title = if is-empty-value(title) { PLACEHOLDER-TITLE } else { title }
  let resolved-course = if is-empty-value(course) { PLACEHOLDER-COURSE } else { course }
  let resolved-group = if is-empty-value(group) { PLACEHOLDER-GROUP } else { group }
  let resolved-teacher = if is-empty-value(teacher) { PLACEHOLDER-TEACHER } else { teacher }
  let resolved-activity-code = if is-empty-value(activity_code) { PLACEHOLDER-ACTIVITY-CODE } else { activity_code }
  let resolved-authors = resolve-authors(authors)

  let author-count = if is-empty-value(authors) {
    0
  } else if type(authors) == array {
    authors.len()
  } else {
    1
  }
  let label-authors = if author-count > 1 {
    COVER-LABEL-AUTHORS-MULTIPLE
  } else {
    COVER-LABEL-AUTHORS-SINGLE
  }

  let current-year = str(datetime.today().year())

  register-document-metadata(
    title: to-string(resolved-title),
    pretitle: to-string(resolved-pretitle),
    course: to-string(resolved-course),
    group: to-string(resolved-group),
    teacher: to-string(resolved-teacher),
    activity-code: to-string(resolved-activity-code),
    authors: resolved-authors,
    year: current-year,
    faculty: faculty,
    school: school,
    custom-variables: custom_variables,
  )

  show: apply-typography-rules
  show: apply-heading-rules
  show: apply-indentation-rules
  show: apply-table-figure-rules

  set page(margin: cover-margin)

  render-cover-page(
    pretitle: resolved-pretitle,
    title: resolved-title,
    course: resolved-course,
    group: resolved-group,
    teacher: resolved-teacher,
    authors: resolved-authors,
    label-authors: label-authors,
    faculty: faculty,
    school: school,
    year: current-year,
  )

  pagebreak()

  set page(
    paper: page-paper,
    numbering: page-numbering,
    number-align: page-number-align,
    margin: body-margin,
  )
  counter(page).update(1)

  set par(
    justify: par-justify,
    leading: par-leading,
    spacing: par-spacing,
    first-line-indent: par-first-line-indent,
  )

  render-body-title(resolved-title)

  doc
}

#let project = standard-report
