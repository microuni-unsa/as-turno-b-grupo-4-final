#let define(name, value) = {
  [#metadata((name: name, value: value)) <var_export>]
}

#let get-var(name, default: none) = context {
  let vars = query(<var_export>)
  let match = vars.find(item => item.value.at("name") == name)
  if match == none {
    if default == none {
      panic("Missing exported var: " + name)
    }
    return default
  }
  match.value.at("value")
}

#let get-all-vars() = context {
  let vars = query(<var_export>)
  let result = (:)
  for item in vars {
    result.insert(item.value.at("name"), item.value.at("value"))
  }
  result
}
