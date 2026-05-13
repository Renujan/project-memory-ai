# Project Memory AI

A VS Code extension that helps developers instantly recover context when returning to a project after days or weeks away. It tracks what you were doing and uses AI to summarize your recent changes and suggest what to work on next.

## Features
- **Smart Summary Panel**: Displays how many days you've been away, files edited, and unfinished TODOs.
- **AI "Welcome Back" Context**: A personalized AI summary of what you were trying to build based on your recent commits.
- **Auto-trigger**: Automatically shows the panel if the project was inactive for 3+ days.
- **Local Memory**: Stores and remembers previous sessions using local vector storage.

## Setup Instructions

This extension requires a **Groq API Key** to generate the AI summaries.
The Groq API has a generous free tier which this extension uses with the `llama3-70b-8192` model.

1. Go to [GroqCloud Console](https://console.groq.com/keys) and generate an API key.
2. Open VS Code.
3. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`).
4. Type and select `Project Memory AI: Set Groq API Key`.
5. Paste your API key and press Enter. The key is stored securely in VS Code's `SecretStorage`.

## Commands

- `Project Memory AI: Show Panel` - Opens the Project Memory sidebar panel manually.
- `Project Memory AI: Refresh Summary` - Regenerates the summary and fetches new data.
- `Project Memory AI: Set Groq API Key` - Update your API key.
- `Project Memory AI: Clear Memory` - Clears the local vector storage for the current workspace.

## Extension Settings

You can find placeholder settings for this extension under `File > Preferences > Settings`.
Note: The actual API key is stored securely, the setting serves only as a descriptive placeholder.

## Tech Stack
- Built in strict TypeScript
- Uses `simple-git` for parsing history
- Uses `vectra` for local vector storage
- Integrates `llama3-70b-8192` via Groq API
