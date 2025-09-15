# Pre-Call Preparation System

An AI-powered system that automatically prepares briefings for upcoming client meetings by analyzing calendar events, previous meeting notes, and conducting external research.

## Features

- Automatic calendar event monitoring
- Previous meeting analysis and summarization
- External company research integration (via Tavily)
- Attendee profile research
- AI-generated meeting summaries
- Automated PDF generation and email delivery
- Chat interface for manual meeting preparation

## Tech Stack

- Frontend:
  - React + TypeScript
  - Vite
  - TailwindCSS
  
- Backend:
  - Node.js + Express
  - TypeScript
  - Google Calendar API
  - OpenAI API
  - Tavily API
  - Perplexity API

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Google Cloud Platform account with Calendar API enabled
- API keys for:
  - OpenAI
  - Tavily

## Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/Joshnaacsha/pre-call-preparation.git
   cd pre-call-preparation
   ```

2. Install dependencies for both frontend and backend:
   ```bash
   # Frontend
   cd frontend
   npm install

   # Backend
   cd ../backend
   npm install
   ```

3. Set up environment variables:
   - Copy `.env.example` to `.env` in both frontend and backend directories
   - Fill in the required environment variables

   Backend environment variables:
   ```env
   PORT=3001
   GOOGLE_CLIENT_ID=your-google-client-id
   GOOGLE_CLIENT_SECRET=your-google-client-secret
   GOOGLE_REDIRECT_URI=http://localhost:3001/oauth2callback
   OPENAI_API_KEY=your-openai-api-key
   TAVILY_API_KEY=your-tavily-api-key
   ```

   Frontend environment variables:
   ```env
   VITE_API_URL=http://localhost:3001
   ```

## Running the Application

1. Start the backend server:
   ```bash
   cd backend
   npm run build
   npm start
   ```

2. Start the frontend development server:
   ```bash
   cd frontend
   npm run dev
   ```

3. Open your browser and navigate to `http://localhost:5173`

## Usage

1. **First-time Setup**:
   - Click "Login with Google" to authorize the application
   - Grant calendar access permissions
   - The system will start monitoring your calendar for upcoming meetings

2. **Automatic Mode**:
   - The system automatically checks for upcoming meetings every few hours
   - When a client meeting is detected, it generates a briefing PDF
   - Briefings are sent via email to internal attendees

3. **Manual Mode**:
   - Use the chat interface to request meeting preparations
   - Type natural language queries about specific meetings or clients
   - Request summaries of previous meetings

## Project Structure

```
pre-call-preparation/
├── backend/
│   ├── src/
│   │   ├── agents/        # AI agents for different tasks
│   │   ├── auth/         # OAuth and authentication
│   │   ├── calendar/     # Calendar integration
│   │   ├── embeddings/   # Text embedding and search
│   │   ├── graph/        # State management
│   │   └── index.ts      # Main server file
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/   # React components
│   │   ├── hooks/       # Custom React hooks
│   │   ├── pages/       # Page components
│   │   └── App.tsx      # Main app component
│   └── package.json
│
└── summaries/           # Generated meeting summaries
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is private and proprietary. Unauthorized copying or distribution is prohibited.

## Contact

Joshnaacsha - [GitHub](https://github.com/Joshnaacsha)
