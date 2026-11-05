export interface SpeechRecognitionOptions {
  lang?: string;
  onStart?: () => void;
  onResult?: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

interface ISpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface ISpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): ISpeechRecognitionAlternative;
  [index: number]: ISpeechRecognitionAlternative;
}

interface ISpeechRecognitionResultList {
  length: number;
  item(index: number): ISpeechRecognitionResult;
  [index: number]: ISpeechRecognitionResult;
}

interface ISpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: ISpeechRecognitionResultList;
}

interface ISpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: ISpeechRecognition, ev: Event) => void) | null;
  onresult:
    | ((this: ISpeechRecognition, ev: ISpeechRecognitionEvent) => void)
    | null;
  onerror:
    | ((this: ISpeechRecognition, ev: ISpeechRecognitionErrorEvent) => void)
    | null;
  onend: ((this: ISpeechRecognition, ev: Event) => void) | null;
}

export class BrowserSpeechApiUnavailableError extends Error {
  readonly code = "BROWSER_SPEECH_API_UNAVAILABLE";
  constructor() {
    super(
      "Web Speech API is not supported or available in this browser environment",
    );
    this.name = "BrowserSpeechApiUnavailableError";
  }
}

export const DEFAULT_SPEECH_LANG = "es-PE";

export function getSpeechRecognitionConstructor(): new () => ISpeechRecognition {
  if (typeof window === "undefined") {
    throw new BrowserSpeechApiUnavailableError();
  }
  const win = window as unknown as {
    SpeechRecognition?: new () => ISpeechRecognition;
    webkitSpeechRecognition?: new () => ISpeechRecognition;
  };
  if (typeof win.SpeechRecognition !== "undefined") {
    return win.SpeechRecognition;
  } else if (typeof win.webkitSpeechRecognition !== "undefined") {
    return win.webkitSpeechRecognition;
  } else {
    throw new BrowserSpeechApiUnavailableError();
  }
}

export function isSpeechSupported(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const win = window as unknown as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  if (typeof win.SpeechRecognition !== "undefined") {
    return true;
  } else if (typeof win.webkitSpeechRecognition !== "undefined") {
    return true;
  } else {
    return false;
  }
}

export class CockpitSpeechRecognizer {
  private recognition: ISpeechRecognition | null = null;
  private listening = false;

  isListening(): boolean {
    return this.listening;
  }

  start(options: SpeechRecognitionOptions): boolean {
    if (!options || typeof options !== "object") {
      throw new Error("SpeechRecognitionOptions must be provided to start()");
    }

    let SpeechRecognitionCtor: new () => ISpeechRecognition;
    try {
      SpeechRecognitionCtor = getSpeechRecognitionConstructor();
    } catch (err) {
      if (err instanceof BrowserSpeechApiUnavailableError) {
        options.onError?.(err.message);
        return false;
      }
      throw err;
    }

    // Abort existing session before starting new one
    this.stop();

    try {
      const recognition = new SpeechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      const targetLang =
        options.lang !== undefined && options.lang.trim() !== ""
          ? options.lang.trim()
          : DEFAULT_SPEECH_LANG;
      recognition.lang = targetLang;

      recognition.onstart = () => {
        this.listening = true;
        options.onStart?.();
      };

      recognition.onresult = (event: ISpeechRecognitionEvent) => {
        let finalTranscript = "";
        let interimTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          if (!res) {
            continue;
          }
          const alt = res[0];
          if (!alt) {
            continue;
          }
          if (res.isFinal) {
            finalTranscript += alt.transcript;
          } else {
            interimTranscript += alt.transcript;
          }
        }

        const transcript =
          finalTranscript !== "" ? finalTranscript : interimTranscript;
        const isFinal = finalTranscript !== "";
        if (transcript !== "") {
          options.onResult?.(transcript, isFinal);
        }
      };

      recognition.onerror = (event: ISpeechRecognitionErrorEvent) => {
        if (
          event.error === "language-not-supported" &&
          recognition.lang === "es-PE"
        ) {
          recognition.lang = "es-ES";
          recognition.start();
          return;
        }
        this.listening = false;
        const errorMessage =
          typeof event.error === "string" && event.error.trim() !== ""
            ? event.error
            : "speech_recognition_error";
        options.onError?.(errorMessage);
      };

      recognition.onend = () => {
        this.listening = false;
        this.recognition = null;
        options.onEnd?.();
      };

      this.recognition = recognition;
      recognition.start();
      return true;
    } catch (err) {
      this.listening = false;
      this.recognition = null;
      const message = err instanceof Error ? err.message : String(err);
      options.onError?.(message);
      return false;
    }
  }

  stop(): void {
    if (this.recognition !== null) {
      const rec = this.recognition;
      this.recognition = null;
      rec.abort();
    }
    this.listening = false;
  }
}
