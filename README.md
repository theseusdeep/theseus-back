# Theseus DeepDive Back-End

Theseus DeepDive is an advanced AI‑powered research assistant that performs iterative, deep research on any topic by combining search engines, web scraping, and large language models. This back‑end service orchestrates complex research workflows, processes user queries, and generates comprehensive research reports.

## Key Features

- **Multi‑Model Support:**  
  Leverages multiple AI models (DeepSeek‑R1, etc.) via Venice.ai. Model usage and token management are handled through integrated VeniceAI calls.

- **Deep Research Workflow:**  
  Enables iterative research with configurable breadth and depth. The system automatically generates follow‑up queries, incorporates previous research context, and supports continuing research with prior learnings.

- **Token Management & Text Splitting:**  
  Uses `js‑tiktoken` alongside a recursive text splitter to efficiently handle large context sizes.

- **Concurrent Processing:**  
  Implements concurrency control using `p-limit` to manage parallel calls, respecting the limits of each model.

- **Robust Logging & Rate Limiting:**  
  - Logs to a local `logs.txt` file, capturing token usage and progress.  
  - Includes a built‑in rate limiter to control request bursts.

- **External Integrations:**  
  - **Google Search & Web Scraping:** Connects to an external API with automatic fallback on bulk timeouts.  
  - **2Captcha Support:** (`TWOCAPTCHA_API_KEY`) is available for captcha solving, if needed in the future.

- **Database Integration:**  
  Uses a serverless PostgreSQL database via Vercel Neon (configured through `DATABASE_URL`) to store user credentials, research histories, and token usage.

- **Flexible Authentication:**  
  - **Cookie‑based** (via `/api/login`)  
  - **API key** (via `x‑api‑key` or `x‑internal‑api‑key` headers)

- **API Endpoints:**  
  - **`POST /api/login`** – Authenticates a user with a username/password and sets an auth cookie.  
  - **`POST /api/feedback`** – Generates follow‑up questions to refine research queries.  
  - **`POST /api/research`** – Initiates the deep research process, returning a research ID for polling.  
  - **`GET /api/research`** – Retrieves the status or final report of a research session by ID.  
  - **`GET /api/research/history`** – Returns a history of research sessions for the logged‑in user.  
  - **`GET /api/models`** – (Deprecated) Lists available AI models.

## Setup & Installation

### Prerequisites

- **Node.js** version 22.x or later
- A valid **PostgreSQL** connection (Vercel Neon recommended)

### Environment Variables

Below is the complete list of environment variables that can be set for the back‑end. Create a file named `.env.local` (or similar) in the project root, and fill it with the appropriate values:

| Variable                       | Description                                                                                                                                                                     | Example Value                     |
|--------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------|
| **INTERNAL_API_KEY**           | Internal API key used for secure access to endpoints. If not using cookie-based auth, supply this key in `x-api-key` headers.                                                  | `mysecretkey123`                  |
| **VENICE_API_KEY**             | Your Venice.ai API key, used to call Venice chat completions.                                                                                                                    | `venice-api-key-abc123`           |
| **VENICE_MODEL**               | The default Venice model ID for research calls.                                                                                                                                 | `deepseek-r1-671b`                |
| **TWOCAPTCHA_API_KEY**         | (Optional) Key for 2Captcha integration, if needed for automated captcha solving.                                                                                                | `2captcha-xyz789`                 |
| **SEARCH_API_KEY**             | API key for the [google‑twitter‑scraper.vercel.app](https://google-twitter-scraper.vercel.app) service.                                                                          | `search-api-key-12345`            |
| **PORT**                       | Port number on which the Express server runs.                                                                                                                                    | `8080`                            |
| **DATABASE_URL**               | Connection string for your Postgres database (e.g., Vercel Neon).                                                                                                                | `postgres://<username>:...`       |
| **VENICE_SUMMARIZATION_MODEL** | (Optional) Model ID used for summarizing large texts before they are consumed by the main research model. Defaults to an LLM like `llama-3.2-3b`.                                 | `llama-3.2-3b`                    |
| **CONTEXT_SIZE**               | The maximum context token size allowed for certain model calls.                                                                                                                  | `131072`                          |
| **SEARCH_SCRAPE_ENDPOINTS**               | Scraping endpoints                                                                                                                | `google-twitter-scraper-london.vercel.app,google-twitter-scraper-stockholm.vercel.app,google-twitter-scraper-paris.vercel.app,google-twitter-scraper-dublin.vercel.app,google-twitter-scraper-frankfurt.vercel.app`                          |


A sample `.env.local` might look like:

```bash
INTERNAL_API_KEY=mysecretkey123
VENICE_API_KEY=venice-api-key-abc123
VENICE_MODEL=deepseek-r1-671b
TWOCAPTCHA_API_KEY=2captcha-xyz789
SEARCH_API_KEY=search-api-key-12345
PORT=8080
DATABASE_URL=postgres://user:pass@hostname/db
VENICE_SUMMARIZATION_MODEL=llama-3.2-3b
CONTEXT_SIZE=131072
SEARCH_SCRAPE_ENDPOINTS=google-twitter-scraper-london.vercel.app,google-twitter-scraper-stockholm.vercel.app,google-twitter-scraper-paris.vercel.app,google-twitter-scraper-dublin.vercel.app,google-twitter-scraper-frankfurt.vercel.app
```

> **Note:** If any of these variables are missing, the server may revert to defaults or encounter errors for certain features.

### Aditional component config when deploying on Digital Ocean

![image](https://github.com/user-attachments/assets/5657f87c-b60b-48f9-89eb-63e15ed2fdca)


### The Role of `VENICE_SUMMARIZATION_MODEL`

When dealing with lengthy or highly fragmented text, the system may need to summarize or condense intermediate results before passing them to the main research model. This is where `VENICE_SUMMARIZATION_MODEL` comes into play:

1. **Intermediate Summaries:**  
   After collecting large amounts of scraped text or partial results, the summarization model is called to generate concise, high‑level summaries. This ensures that the final research model receives a more focused prompt, avoiding token overflows and enabling deeper analysis.

2. **Quality of Output:**  
   By incorporating a specialized summarization model, you reduce "noise" in the prompt, allowing the main model (e.g., `VENICE_MODEL`) to focus on critical details. This often leads to:
   - **More coherent final reports**  
   - **Reduced risk of tangential or irrelevant content**  
   - **Better handling of large contexts**  
   In other words, if you supply a powerful summarization model, the overall quality of your research output can improve, as the main model sees well‑structured input.

3. **Fallback Behavior:**  
   If you do not set `VENICE_SUMMARIZATION_MODEL`, the system defaults to a general summarization approach. This fallback may still work but could be less optimal for large or highly detailed documents.

In short, **`VENICE_SUMMARIZATION_MODEL`** acts as a "pre‑processing step" that shapes raw content into more digestible chunks for the main research pipeline. A high‑caliber summarization model typically leads to more accurate, focused, and efficient final results.

---

### Installation Steps

1. **Clone the Repository**
   ```bash
   git clone <repository-url>
   cd venice-deepdive-backend
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Run the Application**
   - **Express Server Mode:**
     ```bash
     npm run dev
     ```
     This starts the Express server, exposing the API endpoints at `http://localhost:8080` (or the port you specified).
     
   - **Command‑Line Interface Mode:**
     ```bash
     npm run dev -- --run=cli
     ```
     Or directly:
     ```bash
     node dist/run.js
     ```
     This launches the interactive CLI for research sessions.

## Usage

### API Endpoints Overview

1. **Login**
   - **Endpoint:** `POST /api/login`
   - **Description:** Authenticates a user with username/password. On success, sets an HTTP‑only cookie.
   - **Example Request Body:**
     ```json
     {
       "username": "your_username",
       "password": "your_password"
     }
     ```

2. **Generate Feedback**
   - **Endpoint:** `POST /api/feedback`
   - **Description:** Returns follow‑up questions for refining a user's research query.
   - **Example Request Body:**
     ```json
     {
       "query": "Your research topic",
       "selectedModel": "deepseek-r1-671b"
     }
     ```

3. **Start Research**
   - **Endpoint:** `POST /api/research`
   - **Description:** Initiates the deep research process, returning a `researchId` for polling status.
   - **Example Request Body:**
     ```json
     {
       "query": "Detailed research query",
       "breadth": 4,
       "depth": 2,
       "selectedModel": "deepseek-r1-671b",
       "concurrency": 1,
       "sites": ["example.com"],
       "previousContext": [],
       "language": "English"
     }
     ```

4. **Get Research Status / Final Report**
   - **Endpoint:** `GET /api/research?id=<researchId>`
   - **Description:** Retrieves the progress logs and final report (if complete) for the specified `researchId`.

5. **Research History**
   - **Endpoint:** `GET /api/research/history`
   - **Description:** Returns an array of past research sessions for the authenticated user.

### Authentication Options

- **Cookie‑Based Auth**  
  - `POST /api/login` to obtain an auth cookie.
- **API Key Auth**  
  - Provide the correct `INTERNAL_API_KEY` in `x-api-key` or `x-internal-api-key` headers for all `/api` requests.

## Additional Notes

- **Error Handling & Fallbacks:**  
  Automatically trims prompts and employs fallback logic for web scraping and search timeouts.

- **Continuing Research:**  
  Use the `previousContext` field in `/api/research` to build upon prior sessions.

- **Logging & Token Usage:**  
  Token usage is tracked for each request and stored in the database. Detailed logs are appended to `logs.txt`.


## Acknowledgments

- Based on and extending ideas from [Open Deep Research](https://github.com/dzhng/deep-research).  
- Powered by Venice.ai, Vercel Neon, and custom concurrency logic for large language model calls.

---

**Enjoy exploring and extending the Theseus DeepDive back‑end!**
