import { b } from 'baml_client';
import { logger } from './api/utils/logger';

interface FeedbackResponse {
  questions: string[];
  language: string;
}

const modelToClientMap: Record<string, string> = {
  'deepseek-r1-671b': 'DeepSeekClient',
  'gpt-4o': 'GPT4Client',
};

function getClientName(selectedModel?: string): string {
  return selectedModel ? (modelToClientMap[selectedModel] || 'DeepSeekClient') : 'DeepSeekClient';
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
    const clientName = getClientName(selectedModel);
    const feedback = await b.GenerateFeedback.withClient(clientName)(query, numQuestions);
    logger.info('Feedback generated', { questions: feedback.questions, language: feedback.language });
    return { questions: feedback.questions.slice(0, numQuestions), language: feedback.language };
  } catch (error) {
    logger.error('Error generating feedback', { error });
    return fallback;
  }
}
