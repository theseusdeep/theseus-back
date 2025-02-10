# Theseus Back-End

An enhanced fork of [Open Deep Research](https://github.com/dzhng/deep-research), an AI-powered research assistant that performs iterative, deep research on any topic by combining search engines, web scraping, and large language models.

This project builds upon the original CLI tool by adding:
- A modern web interface with real-time research progress
- Support for multiple AI models (DeepSeek-R1, Qwen2.5, & others) powered by [Venice.ai](https://venice.ai/) 🪶
- Concurrent processing capabilities
- Downloadable markdown reports
- Flexible authentication: API endpoints can be accessed either by logging in (user-pass) or by providing the correct API key in the request header.

## API Endpoints

All endpoints are mounted under `/api` and require authentication by one of the following methods:
- **Via API Key:** Attach a valid API key (matching the `INTERNAL_API_KEY` environment variable) in either the `x-api-key` or `x-internal-api-key` header.
- **Via Login Cookie:** If you log in using the `/api/login` endpoint, a cookie will be set. Once authenticated, the API key is not required for subsequent calls.

> **Note:** The `/api/login` endpoint is open (does not require an API key) so that users can obtain authentication credentials.

### 1. **POST `/api/login`**
- **Purpose:** Authenticate a user with a username and password.
- **Request Body:** JSON object with `username` and `password` fields.
- **Response:** On success, returns a JSON object with `{ "success": true }` and sets an HTTP-only authentication cookie.
- **Usage Dependency:** You must log in successfully before accessing other endpoints via the front-end.

### 2. **GET `/api/models`**
- **Purpose:** Retrieve a list of available AI models.
- **Authentication:** Requires either a valid login cookie or a correct API key.
- **Response:** Returns a JSON array of model objects, each containing fields like `id`, `name`, `model_class`, `context_length`, and `max_completion_tokens`.

### 3. **POST `/api/feedback`**
- **Purpose:** Generate follow-up questions based on the user's research query.
- **Request Body:** JSON object containing at least a `query` field and optionally `selectedModel`.
- **Response:** Returns a JSON array of follow-up questions.
- **Usage Dependency:** Must be accessed after login or with a valid API key.

### 4. **POST `/api/research`**
- **Purpose:** Initiate the deep research process on a specified query.
- **Request Body:** JSON object containing parameters such as:
  - `query` (the research query)
  - `breadth` (number of parallel searches)
  - `depth` (levels of iterative research)
  - `selectedModel` (the AI model to use)
  - `concurrency` (number of parallel operations)
  - `sites` (optional list of websites to restrict the search)
- **Response:** Provides real-time progress updates (plain text) and eventually outputs the final research report (in markdown format, prefixed with `REPORT:`).
- **Usage Dependency:** Requires the user to be logged in or a valid API key to be provided.

## Authentication & Usage Notes

- **Front-End Clients:** Users who log in through the UI (with username/password) do not need to send the API key on every request. The authentication cookie is used instead.
- **External API Consumers:** Applications calling these endpoints directly must supply the correct API key in either the `x-api-key` or `x-internal-api-key` header.
- **Endpoint Dependencies:** Except for the login endpoint, all other endpoints require prior authentication either via the login cookie or by attaching the API key.

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
   ```

4. **Verify Tailwind Configuration**
   Ensure the following files are present:
   - `tailwind.config.js`
   - `postcss.config.js`
   - `src/client/index.css`
   
   (See provided sample configurations in the repository if any file is missing.)

5. **Start Development Server**
   ```bash
   # Start both front-end and back-end concurrently
   npm run dev

   # Or start them separately:
   npm run frontend  # Starts Vite dev server
   npm run backend   # Starts Express server
   ```

6. **Access the Application**
   - Frontend: http://localhost:5173
   - Backend: http://localhost:3010

7. **Verify Installation**
   - Ensure that the dark/light theme toggle works.
   - Confirm that the model selection dropdown is populated.
   - Test a simple research query (note: you must log in first via `/api/login`).

## Troubleshooting

### Missing TypeScript Types
Run:
```bash
npm install @types/node @types/react @types/react-dom --save-dev
```

### Tailwind Styles Not Working
Verify that your `tailwind.config.js` includes the correct content paths:
```javascript
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  // ...other configurations
}
```

### Environment Variable Issues
Ensure that your `.env.local` file is in the root directory and correctly formatted.
