#let INDENT-OPEN-MARK = "__indent-open"
#let INDENT-CLOSE-MARK = "__indent-close"
#let NO-INDENT-OPEN-MARK = "__no-indent-open"
#let NO-INDENT-CLOSE-MARK = "__no-indent-close"
#let FORCE-INDENT-OPEN-MARK = "__force-indent-open"
#let FORCE-INDENT-CLOSE-MARK = "__force-indent-close"

#let FORCE-INDENT-DEFAULT-LEVEL = 1
#let INDENT-LEVEL-OFFSET = 1
#let INITIAL-HEADING-NUM-WIDTH = 0pt
#let DEFAULT-INDENT-WIDTH = 12pt
#let DEFAULT-NUM-GUTTER = 0.6em

#let STATE-KEY-HEADING-NUM-WIDTH = "heading-num-width"
#let STATE-KEY-IN-TABLE = "in-table"

#let FIELD-CHILDREN = "children"
#let FIELD-VALUE = "value"
#let EMPTY-STRING = ""
#let ZERO-COUNT = 0

#let heading-num-width = state(STATE-KEY-HEADING-NUM-WIDTH, INITIAL-HEADING-NUM-WIDTH)
#let in-table = state(STATE-KEY-IN-TABLE, false)

#let no-indent-block(body) = [
  #metadata(NO-INDENT-OPEN-MARK)
  #body
  #metadata(NO-INDENT-CLOSE-MARK)
]

#let force-indent-block(body) = [
  #metadata(FORCE-INDENT-OPEN-MARK)
  #body
  #metadata(FORCE-INDENT-CLOSE-MARK)
]

#let is-already-marked(item-body) = {
  let kids = item-body.at(FIELD-CHILDREN, default: none)
  if kids != none and kids.len() > ZERO-COUNT {
    let first-kid = kids.at(ZERO-COUNT)
    first-kid.func() == metadata and first-kid.at(FIELD-VALUE, default: EMPTY-STRING) == INDENT-OPEN-MARK
  } else {
    false
  }
}

#let wrap-list-item(it) = {
  if is-already-marked(it.body) {
    it
  } else {
    list.item[#metadata(INDENT-OPEN-MARK)#it.body#metadata(INDENT-CLOSE-MARK)]
  }
}

#let wrap-enum-item(it) = {
  if is-already-marked(it.body) {
    it
  } else {
    enum.item[#metadata(INDENT-OPEN-MARK)#it.body#metadata(INDENT-CLOSE-MARK)]
  }
}

#let wrap-table(it) = {
  in-table.update(true)
  it
  in-table.update(false)
}

#let auto-indent(
  it,
  indent-width: DEFAULT-INDENT-WIDTH,
  force-level: FORCE-INDENT-DEFAULT-LEVEL,
  indent-level-offset: INDENT-LEVEL-OFFSET,
) = context {
  let marks = query(selector(metadata).before(here(), inclusive: false))
  let nest-depth = marks.filter(m => m.value == INDENT-OPEN-MARK).len() - marks.filter(m => m.value == INDENT-CLOSE-MARK).len()
  let plain-depth = marks.filter(m => m.value == NO-INDENT-OPEN-MARK).len() - marks.filter(m => m.value == NO-INDENT-CLOSE-MARK).len()
  let force-depth = marks.filter(m => m.value == FORCE-INDENT-OPEN-MARK).len() - marks.filter(m => m.value == FORCE-INDENT-CLOSE-MARK).len()
  let h = query(selector(heading).before(here())).at(-1, default: none)

  if force-depth > ZERO-COUNT {
    if h == none {
      block(inset: (left: indent-width * force-level))[#it]
    } else {
      let current-num-width = heading-num-width.get()
      block(inset: (left: indent-width * (h.level - indent-level-offset) + current-num-width))[#it]
    }
  } else if plain-depth > ZERO-COUNT {
    it
  } else if in-table.get() {
    it
  } else if nest-depth > ZERO-COUNT {
    it
  } else if h == none {
    it
  } else {
    let current-num-width = heading-num-width.get()
    block(inset: (left: indent-width * (h.level - indent-level-offset) + current-num-width))[#it]
  }
}

#let indent-heading(
  it,
  indent-width: DEFAULT-INDENT-WIDTH,
  num-gutter: DEFAULT-NUM-GUTTER,
  indent-level-offset: INDENT-LEVEL-OFFSET,
) = {
  let num-content = if it.numbering != none {
    counter(heading).display(it.numbering)
  } else {
    none
  }
  let current-num-width = if num-content != none {
    measure(num-content).width + num-gutter
  } else {
    INITIAL-HEADING-NUM-WIDTH
  }
  heading-num-width.update(current-num-width)
  block(inset: (left: indent-width * (it.level - indent-level-offset)))[
    #grid(
      columns: (current-num-width, 1fr),
      num-content,
      it.body,
    )
  ]
}

#let autoindent(
  doc,
  indent-width: DEFAULT-INDENT-WIDTH,
  num-gutter: DEFAULT-NUM-GUTTER,
  indent-level-offset: INDENT-LEVEL-OFFSET,
  force-level: FORCE-INDENT-DEFAULT-LEVEL,
  include-heading: false,
) = {
  show list.item: wrap-list-item
  show enum.item: wrap-enum-item

  let ai = auto-indent.with(
    indent-width: indent-width,
    force-level: force-level,
    indent-level-offset: indent-level-offset,
  )

  show par: ai
  show enum: ai
  show list: ai
  show bibliography: ai
  show figure: ai
  show raw.where(block: true): ai

  show table: wrap-table

  if include-heading {
    show heading: indent-heading.with(
      indent-width: indent-width,
      num-gutter: num-gutter,
      indent-level-offset: indent-level-offset,
    )
    doc
  } else {
    doc
  }
}

#let apply-autoindent = autoindent
