import { generateObject } from 'ai';
import { z } from 'zod';
import { createModel, deepSeekModel } from './ai/providers';
import { feedbackPrompt } from './feedback_prompt';
import { generateObjectSanitized } from './deep-research';
import { logger } from './api/utils/logger';

interface FeedbackResponse {
  questions: string[];
  language: string;
}

export async function generateFeedback({
  query,
  numQuestions = 3,
  selectedModel,
}: {
  query: string;
  numQuestions?: number;
  selectedModel?: string;
}): Promise<{ questions: string[]; language: string }> {
  const fallback: { questions: string[]; language: string } = {
    questions: [
      'Could you provide more specific details about what you want to learn?',
      'What is your main goal with this research?',
      'Are there any specific aspects you want to focus on?',
    ].slice(0, numQuestions),
    language: 'English',
  };

  try {
    logger.info('generateFeedback called', { query, numQuestions, selectedModel });
    let userFeedback;
    try {
      userFeedback = await generateObjectSanitized({
        model: selectedModel ? createModel(selectedModel) : deepSeekModel,
        system: feedbackPrompt(),
        prompt: `Given the following query from the user, generate ${numQuestions} follow-up questions to clarify the research direction. Also, detect and return the language of the query. Format your response as a JSON object with two keys: "questions" (an array of questions) and "language" (a string representing the detected language).

Query: "${query}"

Example response format:
{"questions": ["What specific aspects of this topic interest you most?", "Are you looking for current developments or historical context?", "What is your intended use case for this information?"], "language": "English"}`,
        schema: z.object({
          questions: z.array(z.string()).min(1).max(numQuestions).describe('Follow up questions to clarify the research direction'),
          language: z.string().describe('Detected language of the user query'),
        }),
        maxTokens: 8192,
        temperature: 0.7,
      });
    } catch (innerError) {
      logger.error('Error in generateObjectSanitized in generateFeedback', { innerError });
      return fallback;
    }

    const typedFeedback = userFeedback.object as FeedbackResponse;
    logger.info('Feedback generated', { questions: typedFeedback.questions, language: typedFeedback.language });
    return { questions: typedFeedback.questions.slice(0, numQuestions), language: typedFeedback.language };
  } catch (error) {
    logger.error('Error generating feedback', { error });
    return fallback;
  }
}
