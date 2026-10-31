import type {
  SttTranscribeResult,
  TtsSynthesizeResult,
} from "@pims/types/agent.ts";
import { VoiceUnavailableError } from "@pims/types/errors.ts";

export interface VoicePort {
  transcribe(args: {
    audio_ref: string;
    lang: string;
  }): Promise<SttTranscribeResult>;
  synthesize(args: {
    text: string;
    voice?: string;
    lang?: string;
  }): Promise<TtsSynthesizeResult>;
}

export function createUnconfiguredVoicePort(): VoicePort {
  return {
    transcribe: async (): Promise<SttTranscribeResult> => {
      throw new VoiceUnavailableError(
        "STT provider is not configured for this deployment (§8.6 voice failure path)",
      );
    },
    synthesize: async (): Promise<TtsSynthesizeResult> => {
      throw new VoiceUnavailableError(
        "TTS provider is not configured for this deployment (§8.6 voice failure path)",
      );
    },
  };
}
