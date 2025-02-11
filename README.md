# Theseus Back-End

An enhanced fork of [Open Deep Research](https://github.com/dzhng/deep-research), an AI-powered research assistant that performs iterative, deep research on any topic by combining search engines, web scraping, and large language models.

This project builds upon the original CLI tool by adding:
- Support for multiple AI models (DeepSeek-R1, Qwen2.5, & others) powered by [Venice.ai](https://venice.ai/) 🪶
- Concurrent processing capabilities
- Downloadable markdown reports
- Flexible authentication: API endpoints can be accessed either by logging in (username/password) or by providing the correct API key in the request header
- **Vercel Neon DB Integration:** Replaces the local SQLite database with a serverless Postgres database on Vercel Neon, ensuring robust, scalable storage without changing the user experience

## API Endpoints

All endpoints are mounted under `/api` and require authentication by one of the following methods:
- **Via API Key:** Attach a valid API key (matching the `INTERNAL_API_KEY` environment variable) in either the `x-api-key` or `x-internal-api-key` header
- **Via Login Cookie:** If you log in using the `/api/login` endpoint, a cookie will be set. Once authenticated, the API key is not required for subsequent calls

> **Note:** The `/api/login` endpoint is open (does not require an API key) so that users can obtain authentication credentials.

### 1. **POST `/api/login`**
**Purpose:** Authenticate a user with a username and password  
**Request Body:** JSON object with `username` and `password` fields  
**Response:** On success, returns a JSON object with `{ "success": true }` and sets an HTTP-only authentication cookie

### 2. **GET `/api/models`**
**Purpose:** Retrieve a list of available AI models  
**Authentication:** Requires either a valid login cookie or a correct API key  
**Response:** Returns a JSON array of model objects, each containing fields like `id`, `name`, `model_class`, `context_length`, and `max_completion_tokens`  
**DEPRECATED - NO USE**

### 3. **POST `/api/feedback`**
**Purpose:** Generate follow-up questions based on the user's research query  
**Request Body:** JSON object containing at least a `query` field and optionally `selectedModel`  
**Response:** Returns a JSON array of follow-up questions

### 4. **POST `/api/research`**
**Purpose:** Initiate the deep research process on a specified query  
**Request Body:** JSON object containing parameters such as:
- `query` (the research query)
- `breadth` (number of parallel searches)
- `depth` (levels of iterative research)
- `selectedModel` (the AI model to use)
- `concurrency` (number of parallel operations)
- `sites` (optional list of websites to restrict the search)

**Response:** Provides real-time progress updates (plain text) and eventually outputs the final research report (in markdown format, prefixed with `REPORT:`)

## Authentication & Usage Notes

- **API Clients:** Applications or scripts calling these endpoints directly must supply the correct API key in either the `x-api-key` or `x-internal-api-key` header, unless they authenticate via the `/api/login` endpoint
- **Endpoint Dependencies:** Except for the login endpoint, all other endpoints require prior authentication either via the login cookie or by attaching the API key

## Installation & Setup

1. **Clone the Repository**
   ```bash
   git clone <repository-url>
   cd venice-deepdive
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Set Up Environment Variables**
   Create a `.env.local` file in the root directory:
   ```bash
   # Venice
   VENICE_API_KEY=<your_venice_api_key>
   VENICE_MODEL=deepseek-r1-671b

   # Research parameters
   MAX_RESEARCH_BREADTH=10
   MAX_RESEARCH_DEPTH=5

   # External API for Google search & web scraping
   SEARCH_API_KEY=<your_search_api_key>

   # Internal API Key for authentication
   INTERNAL_API_KEY=<your_internal_api_key>

   # Neon Database (Vercel Neon DB)
   DATABASE_URL=postgres://<neon_url>
   ```

4. **Start the Back-End Server**
   ```bash
   npm run dev
   ```
   This command starts the Express server that exposes the API endpoints.

5. **Verify Installation**
   - Test a simple research query by first logging in via `/api/login` and then invoking the other endpoints
   - Use tools like Postman or cURL to interact with the API endpoints

### Environment Variable Issues
Ensure that your `.env.local` file is in the root directory and correctly formatted.
