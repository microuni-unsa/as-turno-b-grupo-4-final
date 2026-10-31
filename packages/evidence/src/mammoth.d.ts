declare module "mammoth" {
  interface MammothMessage {
    type: string;
    message: string;
  }

  interface MammothExtractResult {
    value: string;
    messages: MammothMessage[];
  }

  export function extractRawText(input: {
    buffer: Buffer;
  }): Promise<MammothExtractResult>;

  const mammoth: {
    extractRawText: typeof extractRawText;
  };
  export default mammoth;
}
