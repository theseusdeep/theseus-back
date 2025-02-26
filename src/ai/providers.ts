import { getEncoding } from 'js-tiktoken';
import { RecursiveCharacterTextSplitter } from './text-splitter';
import { logger } from '../api/utils/logger';

const defaultContextSize = process.env.CONTEXT_SIZE ? parseInt(process.env.CONTEXT_SIZE) : 120000;

const MinChunkSize = 140;
export const encoder = getEncoding('o200k_base');

/**
 * Trim prompt to maximum context size.
 */
export function trimPrompt(prompt: string, contextSize = defaultContextSize) {
  if (!prompt) {
    return '';
  }

  const length = encoder.encode(prompt).length;
  if (length <= contextSize) {
    return prompt;
  }

  const overflowTokens = length - contextSize;
  const chunkSize = prompt.length - overflowTokens * 3;
  if (chunkSize < MinChunkSize) {
    return prompt.slice(0, MinChunkSize);
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap: 0,
  });
  const trimmedPrompt = splitter.splitText(prompt)[0] ?? '';

  if (trimmedPrompt.length === prompt.length) {
    return trimPrompt(prompt.slice(0, chunkSize), contextSize);
  }

  return trimPrompt(trimmedPrompt, contextSize);
}
