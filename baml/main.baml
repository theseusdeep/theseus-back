// Clients for Venice.ai API
client DeepSeekClient {
  provider openai-generic
  options {
    model "deepseek-r1-671b"
    base_url "https://api.venice.ai/api/v1"
    api_key "{{ env.VENICE_API_KEY }}"
  }
}

client SummarizationClient {
  provider openai-generic
  options {
    model "{{ env.VENICE_SUMMARIZATION_MODEL || 'venice-summarization-default' }}"
    base_url "https://api.venice.ai/api/v1"
    api_key "{{ env.VENICE_API_KEY }}"
  }
}

// Shared types
class SerpQuery {
  query string
  researchGoal string
}

class Learning {
  insight string
  sourceTitle string
  sourceUrl string
}

class TopUrl {
  url string
  description string
}

class SerpResult {
  learnings Learning[]
  followUpQuestions string[]
  topUrls TopUrl[]? // Optional field
}

class FeedbackResponse {
  questions string[]
  language string
}

// Functions
function GenerateSerpQueries(query: string, numQueries: int, learnings: Learning[]) -> SerpQuery[] {
  client DeepSeekClient
  prompt #"
    Generate {{ numQueries }} professional, rigorously crafted, and innovative search queries to explore the following research topic. Each query should be descriptive and of optimal length (approximately 8-12 words) and must be paired with a brief, actionable research goal that leverages modern analytical frameworks and adheres to industry best practices.

    Topic: "{{ query }}"

    Previous insights:
    {{ for l in learnings }}
    - {{ l.insight }} ([{{ l.sourceTitle }}]({{ l.sourceUrl }}))
    {{ endfor }}

    Ensure that the queries are directly aligned with the user's original intent and any provided feedback.

    Return the result as a JSON array of objects, each with "query" and "researchGoal" fields.
  "#
}

function ProcessSerpResult(query: string, summaries: string[], numLearnings: int, numFollowUpQuestions: int, includeTopUrls: bool) -> SerpResult {
  client DeepSeekClient
  prompt #"
    Conduct a rigorous and scholarly analysis of the following search results for "{{ query }}". Generate {{ numLearnings }} key insights, each with the title and URL of the source that supports it, and {{ numFollowUpQuestions }} thought-provoking follow-up questions that are deeply grounded in current research trends and critical evaluation.{{ if includeTopUrls }} Also, identify candidate top recommendations with clear, evidence-based justification.{{ endif }}

    Search Results:
    {{ for s in summaries }}
    {{ s }}
    {{ endfor }}

    Return the result as a JSON object with "learnings", "followUpQuestions", and optionally "topUrls" if includeTopUrls is true.
  "#
}

function GenerateSummary(content: string) -> string {
  client SummarizationClient
  prompt #"
    Based on the following research learnings, generate an executive summary in bullet points. Each bullet point should be a concise statement.

    Research Learnings:
    {{ content }}

    Return the summary as a string with bullet points separated by newlines.
  "#
}

function WriteFinalReport(executiveSummary: string, prompt: string, learnings: Learning[], language: string) -> string {
  client DeepSeekClient
  prompt #"
    Executive Summary:
    {{ executiveSummary }}

    User Input: "{{ prompt }}"

    Research Learnings with Sources:
    {{ for l in learnings }}
    - {{ l.insight }} ([{{ l.sourceTitle }}]({{ l.sourceUrl }}))
    {{ endfor }}

    Write a final research report in Markdown format, in the language "{{ language }}", including sections for Executive Summary, Introduction, Methodology, Key Insights, Recommendations, Conclusion, and References.
  "#
}

function GenerateFeedback(query: string, numQuestions: int) -> FeedbackResponse {
  client DeepSeekClient
  prompt #"
    Given the following query from the user, generate {{ numQuestions }} follow-up questions to clarify the research direction. Also, detect and return the language of the query. Format your response as a JSON object with two keys: "questions" (an array of questions) and "language" (a string representing the detected language).

    Query: "{{ query }}"
  "#
}
