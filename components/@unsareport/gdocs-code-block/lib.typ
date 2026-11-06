#let extract-named-snippet(source, snippet-name, prefix: "//") = {
  let lines = source.split("\n")
  let start-marker = prefix + " START-SNIPPET," + snippet-name
  let end-marker = prefix + " END-SNIPPET"
  let result = lines.fold((false, false, ()), (acc, line) => {
    let found-start = acc.at(0)
    let found-end = acc.at(1)
    let captured = acc.at(2)

    if found-end {
      acc
    } else if not found-start and line.trim() == start-marker {
      (true, false, ())
    } else if found-start and line.trim() == end-marker {
      (true, true, captured)
    } else if found-start {
      (true, false, captured + (line,))
    } else {
      acc
    }
  })

  if result.at(0) and result.at(1) {
    result.at(2).join("\n")
  } else {
    panic("Snippet '" + snippet-name + "' not found or not closed in source")
  }
}

#let code-block(
  source,
  snippet: none,
  prefix: "//",
  lang: "text",
  fill: rgb("#F1F3F4"),
  breakable: true,
  width: 100%,
  inset: 1em,
  radius: 8pt,
  spacing: 0.65em,
  clip: false,
  text-size: 7pt,
) = {
  let code = if snippet == none {
    source
  } else {
    extract-named-snippet(source, snippet, prefix: prefix)
  }

  block(
    fill: fill,
    breakable: breakable,
    width: width,
    inset: inset,
    radius: radius,
    spacing: spacing,
    clip: clip,
  )[
    #set text(size: text-size)
    #set par(justify: false)
    #raw(code, lang: lang, block: true)
  ]
}
