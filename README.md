# Theseus back-end

An enhanced fork of [Open Deep Research](https://github.com/dzhng/deep-research), an AI-powered research assistant that performs iterative, deep research on any topic by combining search engines, web scraping, and large language models.

This project builds upon the original CLI tool by adding:
- A modern web interface with real-time research progress
- Support for multiple AI models (DeepSeek-R1, Qwen2.5, & others) powered by [Venice.ai](https://venice.ai/) 🪶
- Concurrent processing capabilities
- Downloadable markdown reports

## Research Flow

1. Enter your research query
2. Select an AI model
3. Configure research parameters
4. Answer follow-up questions
5. Watch real-time research progress
6. Get a formatted markdown report

## Technical Implementation

The web interface is built with:
- React + TypeScript
- Tailwind CSS for styling
- Vite for development and building
- An Express backend for API handling

The backend integrates with an external API to perform Google searches and scrape URL contents. This enables the research assistant to collect and analyze web data seamlessly.

## Detailed Installation Steps

1. **Clone the Repository**
   ```bash
   git clone <repository-url>
   cd venice-deepdive
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Set up Environment Variables**
   Create a `.env.local` file in the root directory:
   ```bash
   # Venice
   VENICE_API_KEY=<your_venice_api_key>
   VENICE_MODEL=deepseek-r1-671b
   # Research parameters
   MAX_RESEARCH_BREADTH=10
   MAX_RESEARCH_DEPTH=5
   # Login credentials
   USER=<your_username>
   PASSWORD=<your_password>
   # External API for Google search & web scraping
   SEARCH_API_KEY=<your_search_api_key>
   ```

4. **Verify Tailwind Configuration**
   The project uses Tailwind CSS with typography and forms plugins. The configuration files should be present:
   - `tailwind.config.js`
   - `postcss.config.js`
   - `src/client/index.css`

   If any are missing, create them with the following content:

   **postcss.config.js:**
   ```javascript
   module.exports = {
     plugins: {
       tailwindcss: {},
       autoprefixer: {},
     },
   }
   ```

   **src/client/index.css:**
   ```css
   @tailwind base;
   @tailwind components;
   @tailwind utilities;
   ```

5. **Start Development Server**
   ```bash
   # Start both frontend and backend concurrently
   npm run dev

   # Or start them separately:
   npm run frontend  # Starts Vite dev server
   npm run backend   # Starts Express server
   ```

6. **Access the Application**
   - Frontend: [http://localhost:5173](http://localhost:5173)
   - Backend: [http://localhost:3010](http://localhost:3010)

7. **Verify Installation**
   - Check that the dark/light theme toggle works
   - Verify that the model selection dropdown is populated
   - Test a simple research query

## Troubleshooting

- If you encounter missing TypeScript types, run:
  ```bash
  npm install @types/node @types/react @types/react-dom --save-dev
  ```

- If Tailwind styles are not working, verify that your `tailwind.config.js` includes the correct content paths:
  ```javascript
  module.exports = {
    content: [
      "./index.html",
      "./src/**/*.{js,ts,jsx,tsx}",
    ],
    // ...rest of config
  }
  ```

- For environment variable issues, ensure that your `.env.local` file is in the root directory and correctly formatted.

## Usage

1. Open the web interface in your browser
2. Enter your research query
3. Select an AI model from the dropdown
4. Adjust research parameters:
   - **Breadth (2-10):** Controls the number of parallel searches
   - **Depth (1-5):** Controls how many levels deep the research goes
   - **Concurrency:** Number of parallel processes (model-dependent)
5. Answer the follow-up questions to refine the research
6. Monitor the real-time research progress
7. Download or view the final report

## Notes

- Concurrent processing is automatically limited based on the selected model
- Larger models (70B+) are limited to a single concurrent operation
- Smaller models support up to 4 concurrent operations
- The system uses an external API for Google searches and URL scraping, ensuring efficient data retrieval for deep research

