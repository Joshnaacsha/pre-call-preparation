# Pre-Call Preparation System Architecture

## System Overview

The Pre-Call Preparation System is a comprehensive solution that automates meeting preparation by analyzing calendar events, generating briefings, and providing contextual information through a chat interface.

## Architecture Components

```mermaid
graph TB
    subgraph Frontend
        UI[React UI]
        Router[React Router]
        ApiService[API Service]
    end

    subgraph Backend
        Server[Express Server]
        Auth[OAuth Handler]
        
        subgraph Agents
            ChatAgent[Chat Agent]
            RAGAgent[RAG Agent]
            SummaryAgent[Summary Agent]
            PDFAgent[PDF Email Agent]
            TavilyAgent[Tavily Agent]
            LinkedInAgent[LinkedIn Agent]
        end
        
        subgraph Core
            Calendar[Calendar Module]
            Embeddings[Embeddings Module]
            Graph[Graph State]
        end
    end

    subgraph External Services
        Calendar_API[Google Calendar API]
        Gemini[Gemini AI API]
        OpenAI[OpenAI API]
        Tavily[Tavily API]
        SMTP[Email Server]
    end

    subgraph Database
        Supabase[(Supabase)]
        VectorStore[Vector Store]
    end

    UI --> ApiService
    ApiService --> Server
    Server --> Auth
    Auth --> Calendar_API
    
    Server --> Agents
    Agents --> Core
    Core --> External Services
    Core --> Database

    Embeddings --> VectorStore
    VectorStore --> Supabase
```

## API Endpoints

### Authentication
- `GET /api/auth-url` - Get Google OAuth URL
- `GET /api/oauth2callback` - OAuth callback handler

### Core Functionality
- `POST /api/chat` - Chat-based meeting preparation
- `POST /api/start-pipeline` - Manually start preparation pipeline
- `GET /api/health` - Health check endpoint

### Debug & Management
- `GET /api/debug/session/:sessionId` - Debug session state
- `DELETE /api/session/:sessionId` - Clear session data

## Core Modules

### Calendar Module
- Google Calendar integration
- Event monitoring
- PDF generation tracking

### Agents Module
1. Chat Agent
   - Intent classification
   - Conversation management
   - Query routing

2. RAG Agent
   - Document retrieval
   - Context-aware responses
   - Vector similarity search

3. Summary Generation Agent
   - Meeting summary creation
   - Client context analysis
   - Action item extraction

4. PDF Email Agent
   - PDF briefing generation
   - Email formatting
   - Automated distribution

5. Research Agents
   - Tavily web search integration
   - LinkedIn profile analysis
   - External intelligence gathering

### Embeddings Module
- Vector generation (OpenAI)
- Similarity search
- Document storage

### Graph Module
- State management
- Context tracking
- Session handling

## Database Schema

### Meetings Table
\`\`\`sql
CREATE TABLE meetings (
    id SERIAL PRIMARY KEY,
    client_name TEXT NOT NULL,
    project_name TEXT NOT NULL,
    meeting_date TIMESTAMP WITH TIME ZONE NOT NULL,
    attendees TEXT[] NOT NULL,
    summary TEXT,
    meeting_goal TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    pdf_url TEXT,
    raw_summary JSONB,
    embedding vector(1536),
    UNIQUE (client_name, project_name, meeting_date)
);
\`\`\`

## External Services Integration

### Google Calendar API
- OAuth 2.0 authentication
- Calendar event monitoring
- Attendee information retrieval

### AI Services
1. Gemini AI
   - Meeting summary generation
   - Context analysis
   - Intent understanding

2. OpenAI
   - Text embeddings
   - Vector similarity
   - Natural language processing

### Search & Research
1. Tavily API
   - Web intelligence gathering
   - Company research
   - News aggregation

2. LinkedIn Integration
   - Profile analysis
   - Professional context
   - Relationship mapping

### Email Service
- SMTP integration
- PDF attachment handling
- Templated notifications

## Environment Variables

\`\`\`env
# Server Configuration
PORT=3001

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=

# API Keys
GEMINI_API_KEY=
OPENAI_API_KEY=
TAVILY_API_KEY=

# Database
DATABASE_URL=

# Email Configuration
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=

# Feature Flags
RUN_ON_STARTUP=

# Security
JWT_SECRET=

# CORS Configuration
ALLOWED_ORIGINS=
\`\`\`

## Frontend Architecture

### React Components
- MainApp
- LandingPage
- OAuthFlow
- ChatInterface
- MeetingDashboard

### Services
- ApiService
- Authentication
- State Management

### Development Server
- Vite
- Port: 5173
- Proxy configuration for API requests

## Deployment

### Backend
- Node.js server
- Port: 3001
- Express.js framework

### Frontend
- React + Vite
- TailwindCSS
- TypeScript
