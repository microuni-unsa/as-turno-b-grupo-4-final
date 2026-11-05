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

export function isSpeechSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
  );
}

export class CockpitSpeechRecognizer {
  private recognition: ISpeechRecognition | null = null;
  private listening = false;

  isListening(): boolean {
    return this.listening;
  }

  start(options: SpeechRecognitionOptions = {}): boolean {
    if (!isSpeechSupported()) {
      options.onError?.("Reconocimiento de voz no soportado en este navegador");
      return false;
    }

    // Abort existing session before starting new one
    this.stop();

    const windowWithSpeech = window as unknown as {
      SpeechRecognition?: new () => ISpeechRecognition;
      webkitSpeechRecognition?: new () => ISpeechRecognition;
    };

    const SpeechRecognitionCtor =
      windowWithSpeech.SpeechRecognition ||
      windowWithSpeech.webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      options.onError?.("Reconocimiento de voz no disponible");
      return false;
    }

    try {
      const recognition = new SpeechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      let targetLang = options.lang || "es-PE";
      recognition.lang = targetLang;

      let fallbackAttempted = false;

      recognition.onstart = () => {
        this.listening = true;
        options.onStart?.();
      };

      recognition.onresult = (event: ISpeechRecognitionEvent) => {
        let finalTranscript = "";
        let interimTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          if (!res) continue;
          const alt = res[0];
          if (!alt) continue;
          if (res.isFinal) {
            finalTranscript += alt.transcript;
          } else {
            interimTranscript += alt.transcript;
          }
        }

        const transcript = finalTranscript || interimTranscript;
        const isFinal = Boolean(finalTranscript);
        if (transcript) {
          options.onResult?.(transcript, isFinal);
        }
      };

      recognition.onerror = (event: ISpeechRecognitionErrorEvent) => {
        // Fallback from es-PE to es-ES if language is not supported
        if (
          event.error === "language-not-supported" &&
          !fallbackAttempted &&
          targetLang === "es-PE"
        ) {
          fallbackAttempted = true;
          targetLang = "es-ES";
          recognition.lang = targetLang;
          try {
            recognition.start();
            return;
          } catch {
            // Fallthrough to regular error handling
          }
        }

        this.listening = false;
        options.onError?.(event.error || "speech_recognition_error");
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
    if (this.recognition) {
      const rec = this.recognition;
      this.recognition = null;
      try {
        rec.abort();
      } catch {
        // Graceful catch for permission or state errors
      }
    }
    this.listening = false;
  }
}
