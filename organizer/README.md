# Notion Content Organizer

This application automatically classifies and organizes articles in Notion using OpenAI.

## Setup

1.  **Install dependencies**:
    ```bash
    npm install
    ```

2.  **Configure Environment**:
    Copy `.env.example` to `.env` and fill in your values.
    ```bash
    cp .env.example .env
    ```

    - `NOTION_TOKEN`: Your Notion Integration Token.
    - `OPENAI_API_KEY`: Your OpenAI API Key.
    - `TRIAGE_DATABASE_ID`: The ID of the database where new items arrive.
    - `KNOWLEDGE_BASE_DATABASE_ID`: The ID of the database where classified items go.

## Usage

Run the organizer:

```bash
npm start
```

## Logic

1.  Fetches unclassified items from `TRIAGE_DATABASE_ID`.
2.  Fetches the database schema to understand available properties (Select/Multi-select).
3.  Uses OpenAI to analyze the article and determine values for ALL available properties.
4.  Creates a new page in `KNOWLEDGE_BASE_DATABASE_ID` with all content, updated properties, an Emoji icon, and a Cover image.
5.  Archives the original page in `TRIAGE_DATABASE_ID`.
