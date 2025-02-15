import { getEncoding } from 'js-tiktoken';
import { Model } from '../types/ai';
import pLimit from 'p-limit';

import { RecursiveCharacterTextSplitter } from './text-splitter';
import { logger, addTokenUsage } from '../api/utils/logger';

const BASE_URL = 'https://api.venice.ai/api/v1';
const VENICE_API_KEY = process.env.VENICE_API_KEY!;

/**
 * Custom VeniceAI function to call Venice chat completions.
 * It returns an async function that accepts parameters and always sends a request body
 * that includes "venice_parameters": { include_venice_system_prompt: false }.
 * The system prompt is always the first message in the messages array.
 */
function VeniceAI(model: string, options: any = {}) {
  async function call(params: any = {}) {
    // Merge preset options with call-specific parameters.
    const merged = { ...options, ...params };

    // Extract keys that are not valid for the API call.
    // We expect a system prompt and a user prompt.
    const { prompt, system, schema, maxTokens, ...rest } = merged;

    // Build the messages array.
    let messages = [];
    if (rest.messages && Array.isArray(rest.messages)) {
      // If messages are provided, ensure the first message is the system prompt (if available)
      if (system && rest.messages.length > 0 && rest.messages[0].role !== 'system') {
        messages = [{ role: 'system', content: system }, ...rest.messages];
      } else {
        messages = rest.messages;
      }
    } else {
      // If no messages provided, build one from system and prompt.
      messages = [];
      if (system) {
        messages.push({ role: 'system', content: system });
      }
      messages.push({ role: 'user', content: prompt || '' });
    }

    // Construct the request body with only recognized keys.
    const body = {
      model,
      venice_parameters: { include_venice_system_prompt: false },
      temperature: merged.temperature ?? 0.7,
      max_tokens: maxTokens ?? 4096,
      messages,
    };

    logger.debug('Calling VeniceAI API', { model, body });
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VENICE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const jsonResponse = await response.json();
    if (jsonResponse && jsonResponse.usage) {
      addTokenUsage(jsonResponse.usage);
    }
    logger.debug('Received VeniceAI API response', { model, jsonResponse });
    return jsonResponse;
  }
  // Attach modelId so downstream code can inspect the model.
  (call as any).modelId = model;
  return call;
}

// Default model is now taken from the VENICE_MODEL env variable (with a fallback)
export const DEFAULT_MODEL = process.env.VENICE_MODEL || 'deepseek-r1-671b';

// Set the concurrency limit to 1 for plans that allow only a single concurrent API call
export const ConcurrencyLimit = 1;
// A global limiter ensures that all asynchronous calls in this module share the same concurrency limit.
export const globalLimit = pLimit(ConcurrencyLimit);

/**
 * Function to create a model instance.
 * For the default model, simply return the custom VeniceAI function.
 * For others, we pass structuredOutputs: true.
 */
export function createModel(modelId: string) {
  if (modelId === DEFAULT_MODEL) {
    logger.debug('Creating default model instance', { modelId });
    return VeniceAI(modelId);
  } else {
    logger.debug('Creating structuredOutputs model instance', { modelId });
    return VeniceAI(modelId, {
      structuredOutputs: true,
    });
  }
}

/**
 * Fetch available models – now only return the default model defined by VENICE_MODEL.
 */
export async function fetchModels(): Promise<Model[]> {
  const model: Model = {
    id: DEFAULT_MODEL,
    name: DEFAULT_MODEL, // You can change this to a more user‑friendly name if desired.
    available_on_current_plan: true,
    description: '',
    model_class: 'venice',
    context_length: DEFAULT_MODEL === 'deepseek-r1-671b' ? 30000 : 8000,
    max_completion_tokens: 4096,
  };
  logger.info('Fetched models', { model });
  return [model];
}

// Models
export const deepSeekModel = VeniceAI(DEFAULT_MODEL, {
  structuredOutputs: true,
});
export const gpt4Model = VeniceAI('gpt-4o', {
  structuredOutputs: true,
});
export const gpt4MiniModel = VeniceAI('gpt-4o-mini', {
  structuredOutputs: true,
});
export const o3MiniModel = VeniceAI('o3-mini', {
  reasoningEffort: 'medium',
  structuredOutputs: true,
});

const MinChunkSize = 140;
export const encoder = getEncoding('o200k_base');

/**
 * Trim prompt to maximum context size.
 * The context size is now determined by the CONTEXT_SIZE environment variable.
 */
export function trimPrompt(prompt: string, contextSize = process.env.CONTEXT_SIZE ? parseInt(process.env.CONTEXT_SIZE) : 120_000) {
  if (!prompt) {
    return '';
  }

  const length = encoder.encode(prompt).length;
  if (length <= contextSize) {
    return prompt;
  }

  const overflowTokens = length - contextSize;
  // On average it's 3 characters per token, so multiply by 3 to get a rough estimate of the number of characters.
  const chunkSize = prompt.length - overflowTokens * 3;
  if (chunkSize < MinChunkSize) {
    return prompt.slice(0, MinChunkSize);
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap: 0,
  });
  const trimmedPrompt = splitter.splitText(prompt)[0] ?? '';

  // Last catch: if the trimmed prompt is the same length as the original prompt,
  // perform a hard cut.
  if (trimmedPrompt.length === prompt.length) {
    return trimPrompt(prompt.slice(0, chunkSize), contextSize);
  }

  // Recursively trim until the prompt is within the context size.
  return trimPrompt(trimmedPrompt, contextSize);
}
