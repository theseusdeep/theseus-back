export const baml = {
  GenerateSerpQueries: {
    withClient: (clientName: string) => async (query: string, numQueries: number, learnings: string[]) => {
      throw new Error("BAML client not generated");
    },
  },
  ProcessSerpResult: {
    withClient: (clientName: string) => async (
      query: string,
      searchResults: string,
      numLearnings: number,
      numFollowUpQuestions: number,
      includeTopUrls: boolean,
    ) => {
      throw new Error("BAML client not generated");
    },
  },
  GenerateSummary: {
    withClient: (clientName: string) => async (content: string) => {
      throw new Error("BAML client not generated");
    },
  },
  WriteFinalReport: {
    withClient: (clientName: string) => async (prompt: string, executiveSummary: string, formattedLearnings: string) => {
      throw new Error("BAML client not generated");
    },
  },
  GenerateFeedback: {
    withClient: (clientName: string) => async (query: string, numQuestions: number) => {
      // Return a default fallback response for feedback generation.
      return {
        questions: [
          'Could you provide more specific details about what you want to learn?',
          'What is your main goal with this research?',
          'Are there any specific aspects you want to focus on?'
        ].slice(0, numQuestions),
        language: 'English'
      };
    },
  },
};

export const b = baml;
