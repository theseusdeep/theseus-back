import { generateObject } from 'ai';
import { z } from 'zod';
import { createModel, deepSeekModel } from './ai/providers';
import { systemPrompt } from './prompt';
import { generateObjectSanitized } from './deep-research';
import { logger } from './api/utils/logger';

interface FeedbackResponse {
  questions: string[];
}

export async function generateFeedback({
  query,
  numQuestions = 3,
  selectedModel,
}: {
  query: string;
  numQuestions?: number;
  selectedModel?: string;
}): Promise<string[]> {
  const fallbackQuestions = [
    'Could you provide more specific details about what you want to learn?',
    'What is your main goal with this research?',
    'Are there any specific aspects you want to focus on?',
  ].slice(0, numQuestions);

  try {
    logger.info('generateFeedback called', { query, numQuestions, selectedModel });
    let userFeedback;
    try {
      userFeedback = await generateObjectSanitized({
        model: selectedModel ? createModel(selectedModel) : deepSeekModel,
        system: systemPrompt(),
        prompt: `Given the following query from the user, generate ${numQuestions} follow-up questions to clarify the research direction. Format your response as a JSON object with a "questions" array containing the questions as strings.

Query: "${query}"

Example response format:
{
  "questions": [
    "What specific aspects of this topic interest you most?",
    "Are you looking for current developments or historical context?",
    "What is your intended use case for this information?"
  ]
}`,
        schema: z.object({
          questions: z
            .array(z.string())
            .min(1)
            .max(numQuestions)
            .describe('Follow up questions to clarify the research direction'),
        }),
        maxTokens: 8192,
        temperature: 0.7,
      });
    } catch (innerError) {
      logger.error('Error in generateObjectSanitized in generateFeedback', { innerError });
      return fallbackQuestions;
    }

    const typedFeedback = userFeedback.object as FeedbackResponse;
    logger.info('Feedback generated', { questions: typedFeedback.questions });
    return typedFeedback.questions.slice(0, numQuestions);
  } catch (error) {
    logger.error('Error generating feedback', { error });
    return fallbackQuestions;
  }
}
