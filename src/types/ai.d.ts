/* Internal types for AI */
export interface Model {
  id: string;
  name: string;
  available_on_current_plan: boolean;
  description?: string;
  model_class: string;
  context_length: number;
  max_completion_tokens: number;
}

export interface ModelsResponse {
  data: Model[];
}

/* External module declarations for AI and OpenAI */
declare module 'ai' {
  /**
   * Generates an object based on the provided parameters.
   * @param params Parameters for object generation.
   * @returns A promise resolving with the generated object.
   */
  export function generateObject(params: any): Promise<any>;

  /**
   * Generates text based on the provided parameters.
   * @param params Parameters for text generation.
   * @returns A promise resolving with an object containing the generated text.
   */
  export function generateText(params: any): Promise<{ text: string }>;
}

declare module '@ai-sdk/openai' {
  export interface OpenAIOptions {
    apiKey: string;
    baseURL: string;
  }

  export interface ModelOptions {
    structuredOutputs?: boolean;
    reasoningEffort?: string;
  }

  export type OpenAIFunction = (
    model: string,
    options?: ModelOptions,
  ) => any;

  export function createOpenAI(options: OpenAIOptions): OpenAIFunction;
}

/* Minimal type declarations for 'google-it' */
declare module 'google-it' {
  interface GoogleItOptions {
    query: string;
    limit?: number;
    disableConsole?: boolean;
    proxy?: string;
  }

  interface GoogleItResult {
    link: string;
    snippet: string;
    title: string;
  }

  function googleIt(options: GoogleItOptions): Promise<GoogleItResult[]>;

  export default googleIt;
}

/* Minimal type declarations for 'cloudflare-scraper' */
declare module 'cloudflare-scraper' {
  interface CloudflareScraperOptions {
    method?: string;
    body?: string | Record<string, any>;
    formData?: Record<string, any>;
    jar?: any;
    timeout?: number;
    headers?: Record<string, string>;
  }

  function get(url: string, options?: CloudflareScraperOptions): Promise<string>;

  const _default: {
    get: typeof get;
  };

  export { get };
  export default _default;
}

/* Declaration for the report_prompt module */
declare module './report_prompt' {
  export function reportPrompt(): string;
}
