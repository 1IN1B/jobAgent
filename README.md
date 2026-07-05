# JobAgent

An intelligent, fully automated job search and application pipeline. JobAgent bridges the gap between raw LinkedIn job postings and highly personalized, AI-driven outreach.

## 🚀 Project Overview

JobAgent automates the most tedious parts of the job hunt. It scrapes LinkedIn for targeted job postings (e.g., "hiring react.js"), extracts recruiter contact information, and feeds this data into a sophisticated **n8n orchestration workflow**. 

Using advanced AI reasoning models (such as `qwen3.6-27b`), the workflow analyzes the core requirements of each job post and dynamically tailors a clean, professional cover letter before automatically emailing the recruiter.

## 🏗 Architecture

The project consists of two main layers:

### 1. Data Extraction (Playwright/Apify)
- **`linkedin_scraper.js`**: Targeted scraper that searches LinkedIn for specific hiring keywords. It extracts the post text, recruiter name, and email addresses.
- **`linkedin_recruiter_scraper.js`**: An alternative scraper tuned specifically for finding posts made directly by technical recruiters.
- **Output**: The scrapers write cleanly formatted JSON data directly to a centralized state file (`~/.n8n-files/linkedin_posts.json`). Fresh runs automatically wipe old data to ensure a clean slate.

### 2. AI Orchestration (n8n Workflow)
- **`n8n_job_search_workflow.json`**: A highly optimized n8n pipeline that processes the scraped JSON data in batches.
- **Validation**: Uses AI to perform a strict YES/NO check on the post to ensure it's a real job vacancy (filtering out candidates who are just looking for work).
- **JSON-enforced Cover Letters**: Leverages strict JSON formatting instructions to force the reasoning AI to generate a highly tailored, humble cover letter focusing on 1-2 specific technologies mentioned in the post.
- **Deduplication**: Maintains a local state log (`processed_emails.txt`) to guarantee that the same recruiter is never emailed twice across multiple scraper runs.
- **Delivery**: Dispatches the final personalized email, including a Google Drive link to the applicant's resume.

## ⚙️ Setup & Execution

### Prerequisites
- Node.js & npm
- An active n8n instance (local or cloud)
- API keys for your preferred LLM provider (e.g., Groq, OpenRouter) configured in n8n.

### Running the Pipeline

1. **Install Dependencies:**
   ```bash
   npm install
   ```
2. **Run the Scraper:**
   ```bash
   node linkedin_scraper.js
   ```
   *(This will populate `~/.n8n-files/linkedin_posts.json` with fresh leads).*
3. **Trigger n8n:**
   Re-import or activate the `n8n_job_search_workflow.json` inside your n8n dashboard. The workflow will automatically pick up the new JSON file, run the AI analysis, and dispatch the emails.

## 🧠 AI Integration Notes

This pipeline is optimized for reasoning models (specifically Qwen). The n8n workflow employs advanced string parsing to aggressively strip out `<think>` blocks and cleanly extract the JSON payload, ensuring recruiters never see the AI's internal monologue.
