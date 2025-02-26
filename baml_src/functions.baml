// Define clients for different models using the Venice API
client DeepSeekClient {
    provider openai-generic
    options {
        base_url "https://api.venice.ai/api/v1"
        api_key "{{ env.VENICE_API_KEY }}"
        model "deepseek-r1-671b"
    }
}

client GPT4Client {
    provider openai-generic
    options {
        base_url "https://api.venice.ai/api/v1"
        api_key "{{ env.VENICE_API_KEY }}"
        model "gpt-4o"
    }
}

// Define data classes
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

class FeedbackResponse {
    questions string[]
    language string
}

class ProcessSerpResultOutput {
    learnings Learning[]
    followUpQuestions string[]
    topUrls TopUrl[]?
}

// Generate SERP queries
function GenerateSerpQueries(query: string, numQueries: int, learnings: string[]) -> SerpQuery[] {
    client DeepSeekClient // Default client
    prompt #"
        Generate {{ numQueries }} professional, rigorously crafted, and innovative search queries to explore the following research topic. Each query should be descriptive and of optimal length (approximately 8-12 words) and must be paired with a brief, actionable research goal that leverages modern analytical frameworks and adheres to industry best practices.
        
        Topic: "{{ query }}"
        {{ if learnings | length > 0 }}
        Previous insights:
        {{ learnings | join('\n') }}
        {{ endif }}
        Ensure that the queries are directly aligned with the user's original intent and any provided feedback.
        
        {{ ctx.output_format }}
    "#
}

// Process SERP results
function ProcessSerpResult(query: string, searchResults: string, numLearnings: int, numFollowUpQuestions: int, includeTopUrls: bool) -> ProcessSerpResultOutput {
    client DeepSeekClient // Default client
    prompt #"
        Conduct a rigorous and scholarly analysis of the following search results for "{{ query }}". Generate {{ numLearnings }} key insights, each with the title and URL of the source that supports it, and {{ numFollowUpQuestions }} thought-provoking follow-up questions that are deeply grounded in current research trends and critical evaluation.{{ if includeTopUrls }} Also, identify candidate top recommendations with clear, evidence-based justification.{{ endif }}
        
        Search Results:
        {{ searchResults }}
        
        {{ ctx.output_format }}
    "#
}

// Generate executive summary
function GenerateSummary(content: string) -> string {
    client DeepSeekClient // Default client
    prompt #"
        Based on the following research learnings, generate an executive summary in bullet points. Each bullet point should be a concise statement.
        
        Research Learnings:
        {{ content }}
        
        Return the summary as a string with bullet points separated by newlines.
    "#
}

// Write final report
function WriteFinalReport(prompt: string, executiveSummary: string, formattedLearnings: string) -> string {
    client DeepSeekClient // Default client
    prompt #"
        Executive Summary:
        {{ executiveSummary }}
        
        User Input: "{{ prompt }}"
        
        Research Learnings with Sources:
        {{ formattedLearnings }}
        
        Generate a comprehensive research report in Markdown format based on the above information.
    "#
}

// Generate feedback questions
function GenerateFeedback(query: string, numQuestions: int) -> FeedbackResponse {
    client DeepSeekClient // Default client
    prompt #"
        Given the following query from the user, generate {{ numQuestions }} follow-up questions to clarify the research direction. Also, detect and return the language of the query.
        
        Query: "{{ query }}"
        
        {{ ctx.output_format }}
    "#
}
