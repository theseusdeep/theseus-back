import * as fs from 'fs/promises';
import * as readline from 'readline';
import { deepResearch, writeFinalReport } from './deep-research';
import { generateFeedback } from './feedback';
import { logger, finalizeLogs } from './api/utils/logger';

// Ensure that final log entries are written when the process exits.
process.on('exit', () => {
  finalizeLogs();
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Helper function to get user input
function askQuestion(query: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(query, answer => {
      resolve(answer);
    });
  });
}

// run the agent
async function run() {
  logger.info('Run started');
  // Get initial query
  const initialQuery = await askQuestion('What would you like to research? ');

  // Get breadth and depth parameters
  const breadth =
    parseInt(
      await askQuestion('Enter research breadth (recommended 2-10, default 4): '),
      10,
    ) || 4;
  const depth =
    parseInt(
      await askQuestion('Enter research depth (recommended 1-5, default 2): '),
      10,
    ) || 2;

  logger.info('Creating research plan', { initialQuery, breadth, depth });

  // Generate follow-up questions
  const followUpQuestions = await generateFeedback({
    query: initialQuery,
  });

  console.log('\nTo better understand your research needs, please answer these follow-up questions:');
  logger.info('Follow-up questions generated', { followUpQuestions });

  // Collect answers to follow-up questions
  const answers: string[] = [];
  for (const question of followUpQuestions) {
    const answer = await askQuestion(`\n${question}\nYour answer: `);
    answers.push(answer);
  }

  // Combine all information for deep research
  const combinedQuery = `
Initial Query: ${initialQuery}
Follow-up Questions and Answers:
${followUpQuestions.map((q, i) => `Q: ${q}\nA: ${answers[i]}`).join('\n')}
`;

  console.log('\nResearching your topic...');
  logger.info('Starting deep research', { combinedQuery });

  const { learnings, visitedUrls } = await deepResearch({
    query: combinedQuery,
    breadth,
    depth,
  });

  console.log(`\n\nLearnings:\n\n${learnings.join('\n')}`);
  console.log(`\n\nVisited URLs (${visitedUrls.length}):\n\n${visitedUrls.join('\n')}`);
  logger.info('Deep research completed', { learningsCount: learnings.length, visitedUrlsCount: visitedUrls.length });
  console.log('Writing final report...');

  const report = await writeFinalReport({
    prompt: combinedQuery,
    learnings,
    visitedUrls,
  });

  // Save report to file
  await fs.writeFile('report.md', report, 'utf-8');

  console.log(`\n\nFinal Report:\n\n${report}`);
  console.log('\nReport has been saved to report.md');
  logger.info('Final report generated and saved');
  finalizeLogs();

  rl.close();
}

run().catch(error => {
  logger.error('Run encountered an error', { error });
  console.error(error);
});
