import { b } from 'baml_client'; // Import BAML client
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
    const feedback = await b.GenerateFeedback({ query, numQuestions });
    logger.info('Feedback generated', { questions: feedback.questions, language: feedback.language });
    return { questions: feedback.questions.slice(0, numQuestions), language: feedback.language };
  } catch (error) {
    logger.error('Error generating feedback', { error });
    return fallback;
  }
}
