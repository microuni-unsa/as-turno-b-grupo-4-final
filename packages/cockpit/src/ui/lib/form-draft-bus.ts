import type {
  ChatFormMutation,
  GuidedProvenance,
  GuidedReporting,
} from "@pims/types/cockpit.ts";

export const STORAGE_KEY_FORM_DRAFT = "pims_incident_form_draft";

export function extractCurrentFormValues(
  formEl?: HTMLFormElement | null,
): Partial<GuidedReporting> {
  const form =
    formEl ??
    (typeof document !== "undefined"
      ? (document.getElementById("incident-form") as HTMLFormElement | null)
      : null);

  if (!form) {
    return {};
  }

  const result: Partial<GuidedReporting> = {};
  const arrayFieldNames = new Set([
    "affected_cid",
    "affected_data_types",
    "security_measures_adopted",
  ]);

  const elements = form.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >("input, select, textarea");

  for (const el of Array.from(elements)) {
    const name = el.name || (el.id ? el.id.replace(/^field-/, "") : "");
    if (!name) continue;

    const inputType = "type" in el ? String(el.type).toLowerCase() : "text";
    const isSelect = el.tagName ? el.tagName.toUpperCase() === "SELECT" : false;

    if (arrayFieldNames.has(name)) {
      if (inputType === "checkbox") {
        const inputEl = el as HTMLInputElement;
        if (inputEl.checked) {
          const arr =
            ((result as Record<string, unknown>)[name] as string[]) || [];
          if (!arr.includes(inputEl.value)) {
            arr.push(inputEl.value);
          }
          (result as Record<string, unknown>)[name] = arr;
        }
      } else if (isSelect) {
        const selectEl = el as HTMLSelectElement;
        const selected = Array.from(selectEl.selectedOptions || [])
          .map((opt) => opt.value)
          .filter(Boolean);
        (result as Record<string, unknown>)[name] = selected;
      }
      continue;
    }

    if (name === "involves_personal_data") {
      if (inputType === "radio") {
        const radioEl = el as HTMLInputElement;
        if (radioEl.checked) {
          result.involves_personal_data =
            radioEl.value === "true" || radioEl.value === "1";
        }
      }
      continue;
    }

    if (inputType === "radio") {
      const radioEl = el as HTMLInputElement;
      if (radioEl.checked && radioEl.value.trim() !== "") {
        (result as Record<string, unknown>)[name] = radioEl.value.trim();
      }
      continue;
    }

    if (inputType === "checkbox") {
      const checkEl = el as HTMLInputElement;
      if (checkEl.checked) {
        (result as Record<string, unknown>)[name] = checkEl.value;
      }
      continue;
    }

    if (name === "num_affected_subjects") {
      const val = el.value.trim();
      if (val !== "") {
        const num = Number(val);
        result.num_affected_subjects = Number.isNaN(num) ? null : num;
      }
      continue;
    }

    const val = el.value.trim();
    if (val !== "") {
      (result as Record<string, unknown>)[name] = val;
    }
  }

  // Handle dynamic actions if present in DOM
  const actionCards = form.querySelectorAll(".action-card");
  if (actionCards.length > 0) {
    const actions: NonNullable<GuidedReporting["actions"]> = [];
    actionCards.forEach((card) => {
      const typeEl = card.querySelector(
        ".action-type",
      ) as HTMLSelectElement | null;
      const respEl = card.querySelector(
        ".action-responsible",
      ) as HTMLInputElement | null;
      const dateEl = card.querySelector(
        ".action-date",
      ) as HTMLInputElement | null;
      const descEl = card.querySelector(
        ".action-description",
      ) as HTMLTextAreaElement | null;
      const evidEl = card.querySelector(
        ".action-evidence",
      ) as HTMLInputElement | null;

      const description = descEl?.value.trim();
      if (description) {
        const rawType = typeEl?.value;
        const actionType =
          rawType === "A" || rawType === "R" || rawType === "C" ? rawType : "C";
        actions.push({
          action_type: actionType,
          responsible: respEl?.value.trim() || "operador",
          action_date: dateEl?.value || new Date().toISOString().slice(0, 10),
          description,
          evidence: evidEl?.value.trim() || null,
        });
      }
    });
    if (actions.length > 0) {
      result.actions = actions;
    }
  }

  return result;
}

export function emitFormUpdatedEvent(mutation: ChatFormMutation): void {
  if (typeof window === "undefined") return;
  const event = new CustomEvent("cockpit:form-updated", {
    detail: { mutation },
    bubbles: true,
  });
  window.dispatchEvent(event);
}

export function applyFormMutationToDom(
  mutation: ChatFormMutation,
  formEl?: HTMLFormElement | null,
): string[] {
  const root =
    formEl ??
    (typeof document !== "undefined"
      ? ((document.getElementById("incident-form") as HTMLFormElement | null) ??
        document)
      : null);

  if (!root) {
    return [];
  }

  const updatedKeys: string[] = [];
  const fields = mutation.fields;

  for (const [key, val] of Object.entries(fields)) {
    if (val === undefined) continue;

    let applied = false;

    // 1. Radio: involves_personal_data
    if (key === "involves_personal_data") {
      const radios = root.querySelectorAll<HTMLInputElement>(
        'input[name="involves_personal_data"]',
      );
      radios.forEach((r) => {
        const matches =
          (r.value === "true" && val === true) ||
          (r.value === "false" && val === false);
        r.checked = matches;
        r.dispatchEvent(new Event("input", { bubbles: true }));
        r.dispatchEvent(new Event("change", { bubbles: true }));
      });
      if (radios.length > 0) applied = true;
    } else if (
      key === "affected_cid" ||
      key === "affected_data_types" ||
      key === "security_measures_adopted"
    ) {
      // 2. Checkboxes / multi-select
      const checkboxes = root.querySelectorAll<HTMLInputElement>(
        `input[name="${key}"]`,
      );
      if (checkboxes.length > 0 && Array.isArray(val)) {
        checkboxes.forEach((cb) => {
          cb.checked = (val as string[]).includes(cb.value);
          cb.dispatchEvent(new Event("input", { bubbles: true }));
          cb.dispatchEvent(new Event("change", { bubbles: true }));
        });
        applied = true;
      }
      const select = root.querySelector<HTMLSelectElement>(`#field-${key}`);
      if (select && Array.isArray(val)) {
        Array.from(select.options).forEach((opt) => {
          opt.selected = (val as string[]).includes(opt.value);
        });
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        applied = true;
      }
    } else {
      // 3. Text, number, textarea, standard select
      const input =
        root.querySelector<
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >(`#field-${key}`) ??
        root.querySelector<
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >(`[name="${key}"]`);

      if (input && input.type !== "radio" && input.type !== "checkbox") {
        input.value = val === null ? "" : String(val);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        applied = true;
      } else if (input && input.type === "radio") {
        const radio = root.querySelector<HTMLInputElement>(
          `input[name="${key}"][value="${val}"]`,
        );
        if (radio) {
          radio.checked = true;
          radio.dispatchEvent(new Event("input", { bubbles: true }));
          radio.dispatchEvent(new Event("change", { bubbles: true }));
          applied = true;
        }
      }
    }

    if (applied) {
      updatedKeys.push(key);

      // Highlight container
      const inputEl =
        root.querySelector(`#field-${key}`) ??
        root.querySelector(`[name="${key}"]`);
      const container =
        inputEl?.closest(".form-field, .form-group, div") ?? inputEl;
      if (container) {
        container.classList.add(
          "field-highlight-pulse",
          "field-updated-highlight",
        );
        setTimeout(() => {
          container.classList.remove(
            "field-highlight-pulse",
            "field-updated-highlight",
          );
        }, 2000);
      }

      // Update badge
      const badge = (root.querySelector(`#badge-${key}`) ??
        (typeof document !== "undefined"
          ? document.getElementById(`badge-${key}`)
          : null)) as HTMLElement | null;

      if (badge) {
        badge.classList.remove(
          "hidden",
          "provenance-narrative",
          "provenance-partial",
          "provenance-default",
        );
        const prov: GuidedProvenance | undefined = mutation.provenance?.[key];
        const hasVal =
          val !== null &&
          val !== undefined &&
          val !== "" &&
          (!Array.isArray(val) || val.length > 0);

        if (hasVal) {
          if (prov === "partial") {
            badge.classList.add("provenance-partial");
            badge.textContent = "IA: Asistido";
            badge.title = "Parcialmente sugerido por IA";
          } else if (prov === "default") {
            badge.classList.add("provenance-default");
            badge.textContent = "Predeterminado";
            badge.title = "Valor institucional predeterminado";
          } else {
            badge.classList.add("provenance-narrative");
            badge.textContent = "IA: Asistido";
            badge.title =
              "Completado automáticamente por IA a partir de la narrativa";
          }
        } else {
          badge.classList.add("hidden");
        }
      }
    }
  }

  // Also emit event
  emitFormUpdatedEvent(mutation);

  return updatedKeys;
}

export function saveFormDraft(draft: Partial<GuidedReporting>): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY_FORM_DRAFT,
      JSON.stringify(draft),
    );
  } catch (err) {
    console.warn("Error saving form draft to sessionStorage:", err);
  }
}

export function loadFormDraft(): Partial<GuidedReporting> | null {
  if (typeof window === "undefined" || !window.sessionStorage) return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY_FORM_DRAFT);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<GuidedReporting>;
  } catch (err) {
    console.warn("Error loading form draft from sessionStorage:", err);
    return null;
  }
}

export function clearFormDraft(): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY_FORM_DRAFT);
  } catch (err) {
    console.warn("Error clearing form draft from sessionStorage:", err);
  }
}
