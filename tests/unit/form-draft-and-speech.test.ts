import { ChatStore } from "@pims/cockpit/ui/lib/chat-store.ts";
import {
  applyFormMutationToDom,
  clearFormDraft,
  extractCurrentFormValues,
  loadFormDraft,
  STORAGE_KEY_FORM_DRAFT,
  saveFormDraft,
} from "@pims/cockpit/ui/lib/form-draft-bus.ts";
import {
  CockpitSpeechRecognizer,
  isSpeechSupported,
} from "@pims/cockpit/ui/lib/speech-recognition.ts";
import type { ChatFormMutation, ChatResponse } from "@pims/types/cockpit.ts";
import { TEST_INCIDENT_CODE } from "@tests/helpers/test-constants.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Lightweight typed Mock DOM for testing browser utilities in node/bun
class MockEvent {
  type: string;
  bubbles: boolean;
  detail: unknown;
  constructor(type: string, options?: { bubbles?: boolean; detail?: unknown }) {
    this.type = type;
    if (options && typeof options.bubbles === "boolean") {
      this.bubbles = options.bubbles;
    } else {
      this.bubbles = false;
    }
    if (options && options.detail !== undefined) {
      this.detail = options.detail;
    } else {
      this.detail = undefined;
    }
  }
}

type EventCallback = (ev: unknown) => void;

class MockElement {
  id = "";
  name = "";
  type = "text";
  value = "";
  checked = false;
  textContent = "";
  title = "";
  classList = {
    classes: new Set<string>(),
    add(...cls: string[]) {
      for (const c of cls) this.classes.add(c);
    },
    remove(...cls: string[]) {
      for (const c of cls) this.classes.delete(c);
    },
    contains(cls: string) {
      return this.classes.has(cls);
    },
  };
  children: MockElement[] = [];
  parentElement: MockElement | null = null;
  listeners: Record<string, EventCallback[]> = {};

  addEventListener(type: string, fn: EventCallback) {
    let list = this.listeners[type];
    if (!list) {
      list = [];
      this.listeners[type] = list;
    }
    list.push(fn);
  }

  dispatchEvent(ev: { type: string }) {
    const list = this.listeners[ev.type];
    if (list) {
      for (const fn of list) {
        fn(ev);
      }
    } else {
      // No listeners registered for this event type
    }
    return true;
  }

  appendChild(el: MockElement) {
    el.parentElement = this;
    this.children.push(el);
  }

  closest(_selector: string) {
    if (this.parentElement) {
      return this.parentElement;
    }
    return this;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const walk = (node: MockElement) => {
      if (node.matches(selector)) {
        results.push(node);
      }
      for (const child of node.children) {
        walk(child);
      }
    };
    for (const child of this.children) {
      walk(child);
    }
    return results;
  }

  querySelector(selector: string): MockElement | null {
    const list = this.querySelectorAll(selector);
    const first = list[0];
    if (first !== undefined) {
      return first;
    }
    return null;
  }

  tagName = "DIV";

  matches(selector: string): boolean {
    const parts = selector.split(",").map((s) => s.trim());
    for (const part of parts) {
      if (part.toLowerCase() === this.tagName.toLowerCase()) {
        return true;
      }
      if (part.startsWith("#")) {
        if (this.id === part.slice(1)) return true;
      }
      if (part.startsWith("input[name=")) {
        const matchName = part.match(/name="([^"]+)"/);
        const matchVal = part.match(/value="([^"]+)"/);
        if (matchName && this.name !== matchName[1]) continue;
        if (matchVal && this.value !== matchVal[1]) continue;
        return true;
      }
      if (part.startsWith("[name=")) {
        const matchName = part.match(/name="([^"]+)"/);
        if (matchName && this.name === matchName[1]) return true;
      }
    }
    return false;
  }
}

interface WindowMock {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
  CustomEvent?: unknown;
  Event?: unknown;
  dispatchEvent?: (ev: unknown) => boolean;
  addEventListener?: (type: string, listener: EventCallback) => void;
  sessionStorage?: {
    getItem: (key: string) => string | null;
    setItem: (key: string, val: string) => void;
    removeItem: (key: string) => void;
    clear: () => void;
  };
}

describe("Speech Recognition Client Utility", () => {
  const env = globalThis as unknown as { window?: WindowMock };
  const originalWindow = env.window;

  beforeEach(() => {
    env.window = {
      CustomEvent: MockEvent,
      Event: MockEvent,
      dispatchEvent: () => true,
      addEventListener: () => {},
    };
  });

  afterEach(() => {
    env.window = originalWindow;
  });

  it("checks speech support correctly", () => {
    if (env.window) {
      delete env.window.SpeechRecognition;
      delete env.window.webkitSpeechRecognition;
    } else {
      throw new Error("Window environment not initialized");
    }
    expect(isSpeechSupported()).toBe(false);

    if (env.window) {
      env.window.SpeechRecognition = class {};
    } else {
      throw new Error("Window environment not initialized");
    }
    expect(isSpeechSupported()).toBe(true);
  });

  it("handles speech recognition lifecycle and callbacks", () => {
    interface MockInstance {
      lang: string;
      onstart: (() => void) | null;
      onresult: ((ev: unknown) => void) | null;
      onerror: ((ev: unknown) => void) | null;
      onend: (() => void) | null;
    }
    let instanceRef: MockInstance | null = null;
    class MockSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onstart: (() => void) | null = null;
      onresult: ((ev: unknown) => void) | null = null;
      onerror: ((ev: unknown) => void) | null = null;
      onend: (() => void) | null = null;

      start() {
        instanceRef = this;
        this.onstart?.();
      }

      stop() {
        this.onend?.();
      }

      abort() {
        this.onend?.();
      }
    }

    if (env.window) {
      env.window.SpeechRecognition = MockSpeechRecognition;
    } else {
      throw new Error("Window environment not initialized");
    }

    const recognizer = new CockpitSpeechRecognizer();
    let started = false;
    let receivedTranscript = "";
    let receivedFinal = false;

    const success = recognizer.start({
      lang: "es-PE",
      onStart: () => {
        started = true;
      },
      onResult: (transcript, isFinal) => {
        receivedTranscript = transcript;
        receivedFinal = isFinal;
      },
    });

    expect(success).toBe(true);
    expect(recognizer.isListening()).toBe(true);
    expect(started).toBe(true);
    expect(instanceRef).not.toBeNull();
    const inst = instanceRef as unknown as MockInstance;
    expect(inst.lang).toBe("es-PE");

    // Simulate result event
    inst.onresult?.({
      resultIndex: 0,
      results: [
        Object.assign([{ transcript: "incidente de seguridad" }], {
          isFinal: true,
        }),
      ],
    });

    expect(receivedTranscript).toBe("incidente de seguridad");
    expect(receivedFinal).toBe(true);

    recognizer.stop();
    expect(recognizer.isListening()).toBe(false);
  });

  it("falls back to es-ES on language-not-supported error", () => {
    interface FallbackMock {
      lang: string;
      startCount: number;
      onstart: (() => void) | null;
      onerror: ((ev: { error: string }) => void) | null;
      onend: (() => void) | null;
    }
    let instanceRef: FallbackMock | null = null;
    class MockSpeechRecognition {
      lang = "";
      startCount = 0;
      onstart: (() => void) | null = null;
      onerror: ((ev: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;

      start() {
        instanceRef = this;
        this.startCount += 1;
        this.onstart?.();
      }
      abort() {
        this.onend?.();
      }
    }

    if (env.window) {
      env.window.SpeechRecognition = MockSpeechRecognition;
    } else {
      throw new Error("Window environment not initialized");
    }

    const recognizer = new CockpitSpeechRecognizer();
    recognizer.start({ lang: "es-PE" });
    expect(instanceRef).not.toBeNull();
    const inst = instanceRef as unknown as FallbackMock;
    expect(inst.lang).toBe("es-PE");

    // Fire language-not-supported error
    inst.onerror?.({ error: "language-not-supported" });
    expect(inst.lang).toBe("es-ES");
    expect(inst.startCount).toBe(2);
  });
});

describe("Form Draft Bus & Persistence", () => {
  let mockStorage: Record<string, string> = {};
  const env = globalThis as unknown as {
    window?: WindowMock;
    document?: unknown;
  };
  const originalWindow = env.window;
  const originalDoc = env.document;

  beforeEach(() => {
    mockStorage = {};
    env.window = {
      CustomEvent: MockEvent,
      Event: MockEvent,
      dispatchEvent: () => true,
      addEventListener: () => {},
      sessionStorage: {
        getItem: (key: string) => {
          const val = mockStorage[key];
          if (val !== undefined) {
            return val;
          }
          return null;
        },
        setItem: (key: string, val: string) => {
          mockStorage[key] = val;
        },
        removeItem: (key: string) => {
          delete mockStorage[key];
        },
        clear: () => {
          mockStorage = {};
        },
      },
    };
    const docElement = new MockElement();
    (
      docElement as unknown as {
        getElementById: (id: string) => MockElement | null;
      }
    ).getElementById = (id: string) => {
      return docElement.querySelector(`#${id}`);
    };
    env.document = docElement;
  });

  afterEach(() => {
    env.window = originalWindow;
    env.document = originalDoc;
  });

  it("saves, loads and clears form draft in sessionStorage", () => {
    const draft = {
      title: "Filtración en servidor de base de datos",
      incident_type: "MW" as const,
      num_affected_subjects: 150,
    };

    saveFormDraft(draft);
    expect(mockStorage[STORAGE_KEY_FORM_DRAFT]).toBeDefined();

    const loaded = loadFormDraft();
    expect(loaded).toEqual(draft);

    clearFormDraft();
    expect(loadFormDraft()).toBeNull();
  });

  it("extracts values from DOM form structure correctly", () => {
    const form = new MockElement();
    form.id = "incident-form";
    form.tagName = "FORM";

    const titleInput = new MockElement();
    titleInput.tagName = "INPUT";
    titleInput.name = "title";
    titleInput.value = "Ataque Ransomware";
    form.appendChild(titleInput);

    const descInput = new MockElement();
    descInput.tagName = "TEXTAREA";
    descInput.name = "description";
    descInput.value = "Servidor cifrado";
    form.appendChild(descInput);

    const cidCheckbox = new MockElement();
    cidCheckbox.tagName = "INPUT";
    cidCheckbox.type = "checkbox";
    cidCheckbox.name = "affected_cid";
    cidCheckbox.value = "C";
    cidCheckbox.checked = true;
    form.appendChild(cidCheckbox);

    const personalRadio = new MockElement();
    personalRadio.tagName = "INPUT";
    personalRadio.type = "radio";
    personalRadio.name = "involves_personal_data";
    personalRadio.value = "true";
    personalRadio.checked = true;
    form.appendChild(personalRadio);

    const extracted = extractCurrentFormValues(
      form as unknown as HTMLFormElement,
    );
    expect(extracted.title).toBe("Ataque Ransomware");
    expect(extracted.description).toBe("Servidor cifrado");
    expect(extracted.affected_cid).toEqual(["C"]);
    expect(extracted.involves_personal_data).toBe(true);
  });

  it("applies form mutation to DOM and highlights fields", () => {
    const form = new MockElement();
    form.id = "incident-form";
    form.tagName = "FORM";

    const titleInput = new MockElement();
    titleInput.id = "field-title";
    titleInput.name = "title";
    form.appendChild(titleInput);

    const subjectsInput = new MockElement();
    subjectsInput.id = "field-num_affected_subjects";
    subjectsInput.name = "num_affected_subjects";
    form.appendChild(subjectsInput);

    const badgeTitle = new MockElement();
    badgeTitle.id = "badge-title";
    form.appendChild(badgeTitle);

    const mutation: ChatFormMutation = {
      action: "update",
      summary: "Actualización de campos obligatorios",
      fields: {
        title: "Nuevo Título Sugerido por IA",
        num_affected_subjects: 500,
      },
      provenance: {
        title: "narrative",
      },
    };

    let eventFired = false;
    if (env.window) {
      env.window.dispatchEvent = (ev: unknown) => {
        if ((ev as { type: string }).type === "cockpit:form-updated") {
          eventFired = true;
        } else {
          // Unhandled event type
        }
        return true;
      };
    } else {
      throw new Error("Window environment not initialized");
    }

    const updated = applyFormMutationToDom(
      mutation,
      form as unknown as HTMLFormElement,
    );
    expect(updated).toContain("title");
    expect(updated).toContain("num_affected_subjects");
    expect(titleInput.value).toBe("Nuevo Título Sugerido por IA");
    expect(subjectsInput.value).toBe("500");
    expect(badgeTitle.textContent).toBe("IA: Asistido");
    expect(eventFired).toBe(true);
  });
});

describe("ChatStore updates for form context and mutations", () => {
  it("stores form_mutation on assistant nodes and exposes getActiveSessionId", () => {
    const store = new ChatStore();
    store.clearAll();

    const activeId = store.getActiveSessionId();
    expect(typeof activeId).toBe("string");
    expect(activeId.length).toBeGreaterThan(0);

    const userNode = store.addUserMessage(
      `Por favor redactar incidente ${TEST_INCIDENT_CODE} de fuga de datos`,
    );

    const response: ChatResponse = {
      reply: "He preparado el borrador del incidente en el formulario.",
      persona: "auditor",
      citations: [],
      pending_decisions: [],
      tool_calls: ["form_mutation"],
      trace: {
        id: "tr-1",
        title: "Turn 1",
        start_iso: new Date().toISOString(),
        wall_time_ms: 120,
        model_time_ms: 80,
        tool_time_ms: 40,
        idle_time_ms: 0,
        turns_count: 1,
        requests_count: 1,
        tool_calls_count: 1,
        spans: [],
        aggregates: [],
      },
      form_mutation: {
        action: "draft",
        summary: "Borrador de incidente generado",
        fields: {
          title: `Fuga de datos en base de postulantes ${TEST_INCIDENT_CODE}`,
          incident_type: "DL",
          involves_personal_data: true,
        },
      },
    };

    const assistantNode = store.addAssistantResponse(
      userNode.id,
      response,
      false,
    );
    expect(assistantNode.form_mutation).toBeDefined();
    expect(assistantNode.form_mutation?.action).toBe("draft");
    expect(assistantNode.form_mutation?.fields.title).toBe(
      `Fuga de datos en base de postulantes ${TEST_INCIDENT_CODE}`,
    );
  });
});
