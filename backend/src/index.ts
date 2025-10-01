import express, { Request, Response } from 'express';
import cors from 'cors';
import './config/env.js';
import { authorizeAndListEvents } from './calendar/authorize.js';
import { embedAndStoreAllEvents } from './embeddings/embedAndStore.js';
import { 
  handleChatRequest, 
  isActiveSession, 
  startMeetingSession, 
  isMeetingIntent,
  clearConversationState,
  getConversationState 
} from './agents/chatAgent.js';
import { searchPreviousMeetings } from './calendar/searchPreviousMeetings.js';
import { performTavilySearch, processSearchResults, SearchResult, loadCaseStudies, findRelevantCaseStudies, prepareTavilyInputAgent } from './agents/externalSearchAgent.js';
// Updated import: Add Hunter.io research function
import { conductLLMResearch } from './agents/clientSearchAgent.js';
import { generateMeetingSummary } from './agents/summaryGenerationAgent.js';
import { generatePdfAndSendEmail } from './agents/pdfEmailAgent.js';
import { hasPdfBeenGenerated, markPdfAsGenerated } from './calendar/listEvents.js';
import type { GraphState, RetrievedMeeting } from './graph/graphState.js';
import fs from 'fs';
import path from 'path';
import CalendarWorker from './services/calendar-worker.js';

const app = express();

// Configure CORS
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = ['http://localhost:3001', 'http://localhost:3002', 'http://192.168.56.1:3002', 'http://localhost:5173', 'http://127.0.0.1:5173'];
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
  optionsSuccessStatus: 200,
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

// Configure Content-Security-Policy
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; connect-src 'self' http: https: ws:; frame-src 'self' https://login.microsoftonline.com; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'"
  );
  next();
});

app.use(express.json());

// Configure session middleware
import session from 'express-session';

app.use(session({
  secret: 'your-session-secret', // Replace with a real secret in production
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Microsoft Graph OAuth and calendar logic is now handled in authorizeAndListEvents and related modules

// Chat routing utilities
class ChatRouter {
  // Intent classification cache for performance
  private intentCache = new Map<string, string>();
  private readonly MAX_CACHE_SIZE = 100;
  // Store last query context
  private lastQueryContext = new Map<string, {
    timestamp: number;
    query: string;
    client?: string;
    topic?: string;
  }>();

  /**
   * Get the context of the last query for a session
   */
  getLastQueryContext(sessionId: string) {
    return this.lastQueryContext.get(sessionId);
  }

  /**
   * Extract client name from message
   */
  extractClient(message: string): string | undefined {
    // Common company names and known clients
    const companies = ['ford', 'acme', 'apple', 'meta', 'zomato'];
    const lowercaseMsg = message.toLowerCase();
    
    for (const company of companies) {
      if (lowercaseMsg.includes(company)) {
        return company;
      }
    }

    // Try to find client name from context
    const words = lowercaseMsg.split(/\s+/);
    const clientIndex = words.findIndex(w => 
      w === 'client' || w === 'company' || w === 'customer'
    );
    
    if (clientIndex >= 0 && clientIndex < words.length - 1) {
      return words[clientIndex + 1];
    }

    return undefined;
  }

  /**
   * Extract main topic from message
   */
  private extractTopic(message: string): string | undefined {
    const topics = ['meeting', 'discussion', 'call', 'review', 'migration', 'cloud', 'requirements'];
    const lowercaseMsg = message.toLowerCase();
    
    for (const topic of topics) {
      if (lowercaseMsg.includes(topic)) {
        return topic;
      }
    }

    return undefined;
  }

  /**
   * Route incoming message to appropriate handler
   */
  route(message: string, sessionId: string): 'meeting_collection' | 'rag_search' | 'summary_search' {
    // Check if there's an active session first (O(1) operation)
    if (isActiveSession(sessionId)) {
      return 'meeting_collection';
    }

    // Check if this is a follow-up question
    const lastContext = this.lastQueryContext.get(sessionId);
    const isFollowUp = lastContext && 
      (Date.now() - lastContext.timestamp < 5 * 60 * 1000) && // Within 5 minutes
      (
        // Questions about previous context
        message.toLowerCase().includes('what') ||
        message.toLowerCase().includes('when') ||
        message.toLowerCase().includes('why') ||
        message.toLowerCase().includes('how') ||
        message.toLowerCase().includes('who') ||
        message.toLowerCase().includes('where') ||
        message.toLowerCase().includes('then') ||
        message.toLowerCase().includes('discuss') ||
        message.toLowerCase().includes('talk') ||
        message.toLowerCase().includes('about') ||
        message.toLowerCase().startsWith('and') ||
        // Pronouns referring to previous context
        message.toLowerCase().includes('it') ||
        message.toLowerCase().includes('they') ||
        message.toLowerCase().includes('them') ||
        message.toLowerCase().includes('their') ||
        message.toLowerCase().includes('that') ||
        message.toLowerCase().includes('those') ||
        message.toLowerCase().includes('these') ||
        /^[^.!?]*\?$/.test(message) || // Ends with question mark
        message.length < 60 // Short messages are likely follow-ups
      );

    // Check intent with caching
    const intent = this.classifyIntent(message);
    
    if (intent === 'meeting_prep') {
      startMeetingSession(sessionId);
      return 'meeting_collection';
    }

    let currentClient = this.extractClient(message);
    let currentTopic = this.extractTopic(message);

    // If this is a follow-up question, inherit context from last query
    if (isFollowUp && lastContext) {
      currentClient = currentClient || lastContext.client;
      currentTopic = currentTopic || lastContext.topic;
    }

    // Store context for the current query
    this.lastQueryContext.set(sessionId, {
      timestamp: Date.now(),
      query: message,
      client: currentClient,
      topic: currentTopic
    });

    // Always use RAG search for:
    // 1. Follow-up questions (to maintain context)
    // 2. Questions about specific companies
    // 3. Questions about meetings or discussions
    if (isFollowUp || currentClient || 
        message.toLowerCase().includes('meet') || 
        message.toLowerCase().includes('discuss') ||
        message.toLowerCase().includes('talk')) {
      return 'rag_search';
    }

    return intent === 'summary_search' ? 'summary_search' : 'rag_search';
  }

  /**
   * Fast intent classification with caching
   */
  private classifyIntent(message: string): 'meeting_prep' | 'summary_search' | 'general' {
    const cacheKey = message.toLowerCase().trim();
    
    // Check cache first
    if (this.intentCache.has(cacheKey)) {
      return this.intentCache.get(cacheKey) as any;
    }

    let intent: 'meeting_prep' | 'summary_search' | 'general';
    const msg = message.toLowerCase();

    // Meeting preparation patterns
    if (/\b(prepare|meeting|client|tomorrow|today|next week|schedule|brief|get summary)\b/.test(msg)) {
      intent = 'meeting_prep';
    }
    // Summary/search patterns
    else if (/\b(summary|previous|history|last meeting|past meetings|find|search)\b/.test(msg)) {
      intent = 'summary_search';
    }
    // Default to general
    else {
      intent = 'general';
    }

    // Cache the result (with simple LRU)
    this.updateCache(cacheKey, intent);
    
    return intent;
  }

  /**
   * Update cache with LRU eviction
   */
  private updateCache(key: string, value: string): void {
    if (this.intentCache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.intentCache.keys().next().value;
      if (typeof firstKey === 'string') {
        this.intentCache.delete(firstKey);
      }
    }
    this.intentCache.set(key, value);
  }
}

// Initialize router
const chatRouter = new ChatRouter();

import TokenService from './services/token.js';
import DatabaseService from './services/database.js';

// Type definitions for session data
declare module 'express-session' {
  interface SessionData {
    userEmail: string;
  }
}

// Set up calendar polling instead of webhooks for local development
async function subscribeToCalendarChanges(email: string) {
  try {
    console.log('ℹ️ Setting up calendar polling for local development...');
    // Start a polling interval (e.g., every 5 minutes)
    setInterval(async () => {
      try {
        console.log('🔄 Polling calendar for changes...');
        const db = await DatabaseService;
        const userSub = await db.getUserSubscription(email);
        if (userSub && userSub.token_expiry > new Date()) {
          await main(undefined, { session: { userEmail: email } });
        }
      } catch (error) {
        console.error('❌ Error polling calendar:', error);
      }
    }, 5 * 60 * 1000); // 5 minutes

    return { id: 'polling-mode', message: 'Calendar polling activated' };
  } catch (error) {
    console.error('❌ Error creating calendar subscription:', error);
    throw error;
  }
}

// Webhook endpoint for calendar notifications
app.post('/api/webhook/calendar', async (req, res) => {
  try {
    console.log('📅 Received calendar webhook:', req.body);
    const validationToken = req.query.validationToken;
    
    // Handle subscription validation
    if (validationToken) {
      console.log('✅ Validating webhook subscription');
      res.set('Content-Type', 'text/plain');
      return res.send(validationToken);
    }

    // Process the notification
    const notifications = req.body.value;
    for (const notification of notifications) {
      console.log(`📝 Processing calendar change: ${notification.changeType}`);
      // Run the pipeline for the updated calendar
      if (req.session?.userEmail) {
        const db = await DatabaseService;
        const userSub = await db.getUserSubscription(req.session.userEmail);
        if (userSub && userSub.token_expiry > new Date()) {
          await main(undefined, { session: { userEmail: req.session.userEmail } });
        }
      }
    }

    res.status(202).send(); // Accepted
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

// Microsoft Graph OAuth callback endpoint
app.get('/auth/callback', async (req, res) => {
  console.log('🔐 OAuth callback hit:', {
    code: req.query.code ? 'present' : 'missing',
    query: req.query
  });
  
  try {
    // Check for Azure AD specific error response
    if (req.query.error) {
      let errorMessage = 'Authentication failed';
      if (req.query.error === 'access_denied') {
        errorMessage = 'You declined to give the application the required permissions. ' +
                      'The app needs calendar access to help prepare for your meetings.';
      } else {
        errorMessage = `Authentication error: ${req.query.error_description || req.query.error}`;
      }
      throw new Error(errorMessage);
    }
    
    const code = req.query.code as string;
    if (!code) {
      throw new Error('No authorization code received');
    }

    const tokenService = await TokenService;
    const tokens = await tokenService.exchangeCodeForTokens(code);
    
    // Get user info to store with subscription
    const userInfo = await tokenService.getUserInfo(tokens.access_token);
    
    // Calculate token expiry
    const expiryDate = new Date();
    expiryDate.setSeconds(expiryDate.getSeconds() + tokens.expires_in);
    
    // Store subscription in database
    const db = await DatabaseService;
    await db.createUserSubscription(
      userInfo.email,
      tokens.access_token,
      tokens.refresh_token,
      expiryDate
    );
    
    // First, ensure we have a session and store the email
    if (!req.session) {
      throw new Error('No session available');
    }
    
    req.session.userEmail = userInfo.email;
    
    // Create a promise to ensure session is fully saved
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Double check the session was saved
    console.log('Session state after save:', {
      hasSession: !!req.session,
      userEmail: req.session.userEmail,
      sessionID: req.sessionID
    });

    // Now that session is saved, set up calendar subscription
    try {
      console.log('📡 Setting up calendar webhook subscription...');
      await subscribeToCalendarChanges(userInfo.email);
      
      // Start the pipeline with explicit session data
      console.log('🚀 Starting initial pipeline scan...');
      const mockReq = {
        session: {
          userEmail: userInfo.email,
          save: req.session.save.bind(req.session)
        }
      };
      
      // Wait for main pipeline to complete
      const state = await main(undefined, mockReq);
      console.log('Pipeline completed with state:', {
        hasEvents: !!state.calendarEvents,
        eventCount: state.calendarEvents?.length || 0
      });
    } catch (error) {
      console.error('⚠️ Error in setup:', error);
      // Log detailed error info
      console.error('Detailed error:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack trace',
        sessionState: {
          hasSession: !!req.session,
          userEmail: req.session?.userEmail
        }
      });
    }

    // Redirect back to frontend success page
    const successUrl = new URL('/oauth', process.env.FRONTEND_URL);
    successUrl.searchParams.set('auth', 'success');
    successUrl.searchParams.set('direct', 'true');
    res.redirect(successUrl.toString());
  } catch (error) {
    console.error('OAuth callback error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    const errorCode = req.query.error || 'unknown_error';
    const errorSubcode = req.query.error_subcode || '';
    
    // Construct frontend URL with detailed error information
    const redirectUrl = new URL('/oauth', process.env.FRONTEND_URL);
    redirectUrl.searchParams.set('auth', 'error');
    redirectUrl.searchParams.set('message', errorMessage);
    redirectUrl.searchParams.set('error_code', errorCode as string);
    redirectUrl.searchParams.set('error_subcode', errorSubcode as string);
    
    res.redirect(redirectUrl.toString());
  }
});

async function main(initialState?: GraphState, req?: any): Promise<GraphState> {
  console.log('\n[Start] Starting Cprime AI Pre-Call Pipeline...');
  console.log('=' .repeat(60));

  let state: GraphState;

  if (initialState) {
    console.log('🤖 Processing chat-initiated meeting preparation...\n');
    state = initialState;
  } else {
    console.log('🕐 Scanning for client meetings in the next 3 hours...\n');
    // Step 1: Get filtered calendar events (only next 3 hours, client meetings)
    // Use the user email from session to refresh token
    const userEmail = req?.session?.userEmail;
    console.log('🔑 Session Status:', {
      hasSession: !!req?.session,
      hasUserEmail: !!userEmail,
      userEmail: userEmail || 'not found',
      sessionID: req?.sessionID
    });
    const { listUpcomingEvents } = await import('./calendar/listEvents.js');
    state = await authorizeAndListEvents(req, listUpcomingEvents);
  }
  
  // DEBUG: Check what we got from authorize
  console.log('[Debug] State after authorize:', {
    hasCalendarEvents: !!state.calendarEvents,
    eventsLength: state.calendarEvents?.length || 0,
    stateKeys: Object.keys(state),
    firstEvent: state.calendarEvents?.[0]?.summary || 'No events found'
  });

  // Check if any client meetings found in next 3 hours
  if (!state.calendarEvents || state.calendarEvents.length === 0) {
    console.log('[Info] No client meetings found in the next 3 hours.');
    console.log('   - All existing meetings may already have PDFs generated');
    console.log('   - Or no meetings match client/external attendee criteria');
    console.log('   - Pipeline completed successfully with no work needed.\n');
    return state;
  }

  console.log(`📅 Found ${state.calendarEvents.length} client meeting(s) requiring processing:`);
  state.calendarEvents.forEach((event, index) => {
    const timeUntil = getTimeUntilMeeting(event.startTime);
    const urgencyFlag = getUrgencyFlag(event.startTime);
    console.log(`   ${index + 1}. ${urgencyFlag}${event.summary} - ${timeUntil}`);
  });
  console.log('');

  // Step 2: Embed and store all events (now includes automatic duplicate checking)
  await embedAndStoreAllEvents(state);
  console.log('');

  // Step 3: Process each meeting individually
  console.log('🔄 Processing meetings individually...');
  console.log('-' .repeat(40));

  for (let i = 0; i < state.calendarEvents.length; i++) {
    const currentEvent = state.calendarEvents[i];
    const eventId = (state as any).clientEventIds?.[i];
    
    console.log(`\n📋 Processing Meeting ${i + 1}/${state.calendarEvents.length}:`);
    console.log(`   Title: ${currentEvent.summary}`);
    console.log(`   Time: ${new Date(currentEvent.startTime).toLocaleString()}`);
    console.log(`   Attendees: ${currentEvent.attendees.join(', ')}`);

    // Check if PDF already exists for this meeting
    if (hasPdfBeenGenerated(currentEvent, eventId)) {
      console.log(`   ⏭️  PDF already exists - skipping this meeting`);
      continue;
    }

    try {
      // Create individual state for this meeting
      const individualMeetingState: GraphState = {
        calendarEvents: [currentEvent],
        clientEventIds: eventId ? [eventId] : undefined,
        externalResearch: {
          searchQuery: '',
          companyNews: '',
          contactUpdates: '',
        },
      };

      // Step 3a: Search for previous meetings for this specific event
      console.log(`   🔍 Searching previous meetings for "${currentEvent.summary}"...`);
  const results = await searchPreviousMeetings(currentEvent.summary, currentEvent.startTime);
      
      const convertedMeetings: RetrievedMeeting[] = results.map((doc: { metadata: any; pageContent: any; }) => {
        const { metadata, pageContent } = doc;
        return {
          metadata: {
            summary: metadata.summary ?? '',
            startTime: metadata.startTime ?? '',
          },
          pageContent,
        };
      });

      individualMeetingState.previousMeetingsByProject = {
        [currentEvent.summary]: convertedMeetings
      };

      console.log(`   📚 Found ${convertedMeetings.length} related previous meetings`);
      
      // Step 3b: External research for this meeting (Tavily search)
      console.log(`   🌐 Conducting external company research...`);
      try {
        const researchedState = await prepareTavilyInputAgent(individualMeetingState);
        individualMeetingState.externalResearch = researchedState.externalResearch;
        console.log(`   ✅ External company research completed`);
        
        // Show brief research summary
        if (researchedState.externalResearch?.searchQuery) {
          console.log(`      🔍 Search: ${researchedState.externalResearch.searchQuery}`);
          const newsLength = researchedState.externalResearch.companyNews?.length || 0;
          console.log(`      📊 Company Data: ${newsLength} characters`);
        }
      } catch (error) {
        console.error(`   ⚠️  External company research failed: ${error}`);
        // Continue without external research
      }

      // Step 3c: UPDATED - Hunter.io + AI Professional Research for attendees
      console.log(`   🎯 Conducting enhanced attendee research (Hunter.io + AI)...`);
      try {
        // Try Hunter.io first, fallback to LinkedIn research if Hunter.io unavailable
        const hunterApiKey = process.env.HUNTER_API_KEY;
        let researchState;
        
  // Hunter.io research is not available, fallback to LLM research
  console.log(`      🔗 Using AI-only research (Hunter.io not configured)...`);
  researchState = await conductLLMResearch(individualMeetingState);
        
        // Merge the contactUpdates from research with existing externalResearch
        individualMeetingState.externalResearch = {
          searchQuery: researchState.externalResearch?.searchQuery || individualMeetingState.externalResearch?.searchQuery || '',
          companyNews: researchState.externalResearch?.companyNews || individualMeetingState.externalResearch?.companyNews || '',
          contactUpdates: researchState.externalResearch?.contactUpdates || individualMeetingState.externalResearch?.contactUpdates || '',
        };
        
        console.log(`   ✅ Attendee research completed`);
        
        // Show brief research summary
        const contactLength = researchState.externalResearch?.contactUpdates?.length || 0;
        const isHunterData = researchState.externalResearch?.contactUpdates?.includes('Hunter.io') || false;
        console.log(`      👥 Attendee Data: ${contactLength} characters ${isHunterData ? '(Hunter.io verified)' : '(AI analysis)'}`);
      } catch (error) {
        console.error(`   ⚠️  Attendee research failed: ${error}`);
        // Continue without attendee research
      }
      
      // Step 3d: Generate meeting summary (now includes all research data)
      console.log(`   🤖 Generating AI meeting summary...`);
      try {
        const summaryState = await generateMeetingSummary(individualMeetingState);
        individualMeetingState.summary = summaryState.summary;
        console.log(`   ✅ Summary generated (${summaryState.summary?.length || 0} characters)`);
        
        // Show data sources used in summary
        const hasCompanyNews = (individualMeetingState.externalResearch?.companyNews?.length || 0) > 50;
        const hasAttendeeData = individualMeetingState.externalResearch?.contactUpdates && 
          !individualMeetingState.externalResearch.contactUpdates.includes('skipped');
        const hasPreviousMeetings = convertedMeetings.length > 0;
        const isHunterEnhanced = individualMeetingState.externalResearch?.contactUpdates?.includes('Hunter.io') || false;
        
        console.log(`      📊 Data sources: Company news: ${hasCompanyNews ? 'Yes' : 'No'}, Attendee profiles: ${hasAttendeeData ? (isHunterEnhanced ? 'Hunter.io' : 'AI') : 'No'}, Previous meetings: ${hasPreviousMeetings ? 'Yes' : 'No'}`);
        
      } catch (error) {
        console.error(`   ❌ Summary generation failed:`, error);
        continue; // Skip to next meeting if summary fails
      }

      // Step 3e: Save individual summary to file
      const summaryFileName = `briefing-${currentEvent.summary.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.md`;
      const summaryPath = path.join(process.cwd(), 'summaries', summaryFileName);
      
      // Create summaries directory if it doesn't exist
      const summariesDir = path.join(process.cwd(), 'summaries');
      if (!fs.existsSync(summariesDir)) {
        fs.mkdirSync(summariesDir, { recursive: true });
      }
      
      // Write summary to file
      if (individualMeetingState.summary) {
        fs.writeFileSync(summaryPath, individualMeetingState.summary);
        console.log(`   💾 Summary saved: ${summaryFileName}`);
      }

      // Step 3f: Generate PDF and send email
      console.log(`   📧 Generating PDF and sending email...`);
      try {
        const finalState = await generatePdfAndSendEmail(individualMeetingState);
        
        if (finalState.pdfPath && finalState.pdfPath !== 'already-exists') {
          // Mark PDF as generated for deduplication
          markPdfAsGenerated(currentEvent, finalState.pdfPath, eventId);
          
          console.log(`   ✅ PDF generated: ${path.basename(finalState.pdfPath)}`);
          
          // Check if email was sent
          const cprimeAttendee = currentEvent.attendees.find(email => 
            email.toLowerCase().includes('licet.ac.in') || 
            email.toLowerCase().includes('@cprime.com')
          );
          
          if (cprimeAttendee) {
            console.log(`   📧 Email sent to: ${cprimeAttendee}`);
          } else {
            console.log(`   ⚠️  PDF saved but no internal attendee found for email`);
          }
        } else {
          console.log(`   ⚠️  PDF generation completed but no path returned`);
        }
        
      } catch (error) {
        console.error(`   ❌ PDF/Email generation failed:`, error);
        // Continue with next meeting
      }

      console.log(`   ✅ Meeting "${currentEvent.summary}" processed successfully`);

    } catch (error) {
      console.error(`   ❌ Error processing meeting "${currentEvent.summary}":`, error);
      // Continue with next meeting even if this one fails
    }

    // Add small delay between meetings to avoid overwhelming services
    if (i < state.calendarEvents.length - 1) {
      console.log(`   ⏳ Waiting 2 seconds before next meeting...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Final summary with enhanced reporting
  console.log('\n🎉 PIPELINE COMPLETED!');
  console.log('=' .repeat(40));
  console.log(`📊 Results Summary:`);
  console.log(`   - Total client meetings found: ${state.calendarEvents.length}`);
  console.log(`   - Processing completed at: ${new Date().toLocaleString()}`);
  console.log(`   - Check your email and summaries folder for briefing materials`);
  console.log(`   - PDFs are tracked to prevent duplicate generation`);
  console.log(`   - Embeddings are now tracked to prevent duplicates`);
  
  // Show urgency summary
  const urgentMeetings = state.calendarEvents.filter(event => {
    const diffMs = new Date(event.startTime).getTime() - new Date().getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    return diffHours < 1;
  });
  
  if (urgentMeetings.length > 0) {
    console.log(`\n🚨 URGENT MEETINGS (< 1 hour):`);
    urgentMeetings.forEach(event => {
      const timeUntil = getTimeUntilMeeting(event.startTime);
      console.log(`   - ${event.summary} - ${timeUntil}`);
    });
  }

  // Enhanced research summary with Hunter.io status
  console.log(`\n📊 RESEARCH CAPABILITIES:`);
  const hasHunter = process.env.HUNTER_API_KEY && !process.env.HUNTER_API_KEY.startsWith("your_hunter_api_key");
  const hasOpenAI = process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.startsWith("your_api_key");
  const hasTavily = process.env.TAVILY_API_KEY && !process.env.TAVILY_API_KEY.startsWith("your_tavily_api_key");
  const hasGemini = process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.startsWith("your_gemini_api_key");
  
  console.log(`   - Attendee Research: ${hasHunter ? 'Hunter.io + AI (Enhanced)' : hasOpenAI ? 'AI Only (Basic)' : 'Disabled'}`);
  console.log(`   - Company Research: ${hasTavily ? 'Tavily (Enabled)' : 'Disabled'}`);
  console.log(`   - Meeting Summaries: ${hasGemini ? 'Gemini (Enabled)' : 'Disabled'}`);

  

  console.log('\n✅ Pre-call preparation pipeline completed successfully!');
  return state;
}

/**
 * Helper function to calculate time until meeting
 */
function getTimeUntilMeeting(startTime: string): string {
  const now = new Date();
  const meetingTime = new Date(startTime);
  const diffMs = meetingTime.getTime() - now.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (diffMs < 0) {
    return 'Already started';
  } else if (diffHours > 0) {
    return `in ${diffHours}h ${diffMinutes}m`;
  } else {
    return `in ${diffMinutes}m`;
  }
}

/**
 * Helper function to get urgency flag for display
 */
function getUrgencyFlag(startTime: string): string {
  const now = new Date();
  const meetingTime = new Date(startTime);
  const diffMs = meetingTime.getTime() - now.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  
  if (diffHours < 1) {
    return '🚨 ';
  } else if (diffHours <= 2) {
    return '⏰ ';
  }
  return '';
}

/**
 * Scheduled runner function that can be called periodically
 */
export async function runScheduledPipeline(): Promise<void> {
  const startTime = new Date();
  console.log(`\n⏰ Scheduled pipeline run started at: ${startTime.toLocaleString()}`);
  
  try {
    await main();
  } catch (error) {
    console.error('❌ Scheduled pipeline run failed:', error);
  }
  
  const endTime = new Date();
  const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
  console.log(`⏱️  Pipeline completed in ${duration} seconds`);
}

// API endpoint to start the pipeline manually
app.post('/api/start-pipeline', async (req, res) => {
  try {
    // Check if we have a valid session with user email
    if (!req.session?.userEmail) {
      throw new Error('No valid session found. Please authenticate first.');
    }

    // Update pipeline status
    updatePipelineStatus('started');

    // Get user subscription with valid token
    const db = await DatabaseService;
    const userSub = await db.getUserSubscription(req.session.userEmail);
    if (!userSub || userSub.token_expiry <= new Date()) {
      throw new Error('Invalid or expired subscription');
    }

    // Start the pipeline with the user's token
    const state = await main(undefined, { session: { userEmail: req.session.userEmail } });

    // Update pipeline status on completion
    updatePipelineStatus('completed');

    res.json({
      success: true,
      message: 'Pipeline started successfully',
      events: state.calendarEvents?.length || 0
    });
  } catch (error) {
    console.error('❌ Error in pipeline:', error);
    updatePipelineStatus('error', undefined, error instanceof Error ? error.message : 'Unknown error');
    res.status(500).json({ 
      success: false, 
      error: 'Pipeline failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// NEW: Endpoint to check API configuration status
app.get('/api/config-status', (req, res) => {
  const hasHunter = process.env.HUNTER_API_KEY && !process.env.HUNTER_API_KEY.startsWith("your_hunter_api_key");
  const hasOpenAI = process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.startsWith("your_api_key");
  const hasTavily = process.env.TAVILY_API_KEY && !process.env.TAVILY_API_KEY.startsWith("your_tavily_api_key");
  const hasGemini = process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.startsWith("your_gemini_api_key");
  
  res.json({
    attendeeResearch: {
      type: hasOpenAI ? 'ai_only' : 'disabled',
      status: hasOpenAI ? 'AI Only' : 'Disabled'
    },
    companyResearch: {
      type: hasTavily ? 'tavily' : 'disabled',
      status: hasTavily ? 'Tavily (Enabled)' : 'Disabled'
    },
    summaryGeneration: {
      type: hasGemini ? 'gemini' : 'disabled', 
      status: hasGemini ? 'Gemini (Enabled)' : 'Disabled'
    },
    recommendations: {
      tavily: hasTavily ? null : 'Add TAVILY_API_KEY for company research',
      gemini: hasGemini ? null : 'Add GEMINI_API_KEY for AI summaries'
    }
  });
});

// Handler functions for different request types
async function handleMeetingRequest(
  message: string, 
  context: string | undefined, 
  sessionId: string, 
  res: Response,
  req: any
): Promise<Response> {
  console.log('Processing meeting preparation request...');
  
  try {
    const chatResult = await handleChatRequest({ message, context, sessionId });
    
    if (chatResult.needsMoreInfo) {
      console.log('More info needed, sending follow-up question');
      return res.json({
        success: true,
        needsMoreInfo: true,
        followUpQuestion: chatResult.followUpQuestion,
        type: 'meeting_preparation',
        currentState: getConversationState(sessionId)
      });
    }

    if (chatResult.graphState && chatResult.summary) {
      console.log('Meeting info collected, starting full research pipeline...');
      
      // Clear the session since we have all needed info
      clearConversationState(sessionId);
      
      // Run the research pipeline and wait for results
      const researchedState = await runFullResearchPipeline(chatResult.graphState, req);

      // Return the comprehensive results to the user
      return res.json({
        success: true,
        needsMoreInfo: false,
        reply: researchedState.summary,
        suggestedQuestions: [
          'What are the key discussion points?',
          'Tell me more about the attendees',
          'What were the previous meetings about?'
        ],
        type: 'meeting_preparation_complete',
        hasCompanyResearch: !!researchedState.externalResearch?.companyNews,
        hasAttendeeResearch: !!researchedState.externalResearch?.contactUpdates,
        hasPreviousMeetings: !!(researchedState.previousMeetingsByProject && 
                             Object.values(researchedState.previousMeetingsByProject)[0]?.length > 0)
      });

      // Line removed as it's no longer needed
    }

    // If we get here, something went wrong
    return res.status(500).json({
      success: false,
      error: 'Failed to process meeting information'
    });

  } catch (error) {
    console.error('Error in meeting request handler:', error);
    return res.status(500).json({
      success: false,
      error: 'Meeting processing failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Chat-specific research pipeline function
async function runFullResearchPipeline(initialState: GraphState, req?: any): Promise<GraphState> {
  console.log('\nStarting full research pipeline for chat-initiated meeting...');
  console.log('='.repeat(60));
  
  // Start by loading case studies to ensure they're available
  await loadCaseStudies();
  
  try {
    if (!initialState.calendarEvents || initialState.calendarEvents.length === 0) {
      console.log('No calendar events in state - pipeline aborted');
      throw new Error('No calendar events found');
    }

    const currentEvent = initialState.calendarEvents[0];
    console.log(`Processing: ${currentEvent.summary}`);
    console.log(`Attendees: ${currentEvent.attendees.join(', ')}`);

    // Step 1: Search for previous meetings
    console.log('Searching previous meetings...');
    const results = await searchPreviousMeetings(currentEvent.summary, currentEvent.startTime);
    
    const convertedMeetings: RetrievedMeeting[] = results.map((doc: { metadata: any; pageContent: any; }) => {
      const { metadata, pageContent } = doc;
      return {
        metadata: {
          summary: metadata.summary ?? '',
          startTime: metadata.startTime ?? '',
        },
        pageContent,
      };
    });

    initialState.previousMeetingsByProject = {
      [currentEvent.summary]: convertedMeetings
    };

    console.log(`Found ${convertedMeetings.length} related previous meetings`);

    // Step 2: External company research (Tavily)
    console.log('Conducting external company research...');
    try {
      const researchedState = await prepareTavilyInputAgent(initialState);
      initialState.externalResearch = researchedState.externalResearch;
      console.log('External company research completed');
      
      if (researchedState.externalResearch?.searchQuery) {
        console.log(`Search: ${researchedState.externalResearch.searchQuery}`);
        const newsLength = researchedState.externalResearch.companyNews?.length || 0;
        console.log(`Company Data: ${newsLength} characters`);
      }
    } catch (error) {
      console.error('External company research failed:', error);
    }

      // Step 3: AI attendee research
      console.log('Conducting AI attendee research...');
      try {
        const researchState = await conductLLMResearch(initialState);      // Merge research results
      initialState.externalResearch = {
        searchQuery: researchState.externalResearch?.searchQuery || initialState.externalResearch?.searchQuery || '',
        companyNews: researchState.externalResearch?.companyNews || initialState.externalResearch?.companyNews || '',
        contactUpdates: researchState.externalResearch?.contactUpdates || initialState.externalResearch?.contactUpdates || '',
      };
      
      console.log('Attendee research completed');
      
      const contactLength = researchState.externalResearch?.contactUpdates?.length || 0;
      const isHunterData = researchState.externalResearch?.contactUpdates?.includes('Hunter.io') || false;
      console.log(`Attendee Data: ${contactLength} characters ${isHunterData ? '(Hunter.io verified)' : '(AI analysis)'}`);
    } catch (error) {
      console.error('Attendee research failed:', error);
    }

    // Step 4: Generate comprehensive meeting summary
    console.log('Generating comprehensive AI meeting summary...');
    try {
      const summaryState = await generateMeetingSummary(initialState);
      initialState.summary = summaryState.summary;
      console.log(`Comprehensive summary generated (${summaryState.summary?.length || 0} characters)`);
      
      // Show data sources used
      const hasCompanyNews = (initialState.externalResearch?.companyNews?.length || 0) > 50;
      const hasAttendeeData = initialState.externalResearch?.contactUpdates && 
        !initialState.externalResearch.contactUpdates.includes('skipped');
      const hasPreviousMeetings = convertedMeetings.length > 0;
      const isHunterEnhanced = initialState.externalResearch?.contactUpdates?.includes('Hunter.io') || false;
      
      console.log(`Data sources: Company news: ${hasCompanyNews ? 'Yes' : 'No'}, Attendee profiles: ${hasAttendeeData ? (isHunterEnhanced ? 'Hunter.io' : 'AI') : 'No'}, Previous meetings: ${hasPreviousMeetings ? 'Yes' : 'No'}`);
      
    } catch (error) {
      console.error('Summary generation failed:', error);
      throw error;
    }

    console.log(`Full research pipeline completed for: ${currentEvent.summary}`);
    console.log('='.repeat(60));

    return initialState;

  } catch (error) {
    console.error('Full research pipeline failed:', error);
    throw error;
  }
}

async function handleRagQuery(message: string, res: Response, sessionId: string = 'default'): Promise<Response> {
  console.log('🔍 Processing RAG query...');
  
  // Ensure case studies are loaded
  await loadCaseStudies();
  try {
    const { generateResponse } = await import('./agents/ragAgent.js');

    // Extract client from current message
    const currentClient = chatRouter.extractClient(message);

    // Get context from last query if it exists
    const lastContext = chatRouter.getLastQueryContext(sessionId);
    let enhancedQuery = message;
    
    // Use current client or inherit from context
    const clientContext = currentClient || lastContext?.client;

    // If this is a follow-up question and we have context, enhance the query
    if (lastContext && Date.now() - lastContext.timestamp < 5 * 60 * 1000) {
      if (clientContext) {
        enhancedQuery = `${enhancedQuery} about ${clientContext}`;
      }
      if (lastContext.topic) {
        enhancedQuery = `${enhancedQuery} regarding ${lastContext.topic}`;
      }
    }

    console.log(`🔄 Enhanced query: "${enhancedQuery}"${clientContext ? ` for client: ${clientContext}` : ''}`);
    const ragResponse = await generateResponse(enhancedQuery, clientContext);
    
    return res.json({
      success: true,
      reply: ragResponse.answer,
      suggestedQuestions: ragResponse.suggestedQuestions,
      sources: ragResponse.sources,
      type: 'rag_response'
    });
  } catch (error) {
    console.error('❌ Error in RAG query handler:', error);
    return res.status(500).json({
      success: false,
      error: 'RAG query failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

async function handleSummarySearch(message: string, res: Response): Promise<Response> {
  console.log('📚 Processing summary search...');
  
  try {
    const { searchDocuments } = await import('./embeddings/embedAndStore.js');
    const summaries = await searchDocuments(message);
    
    if (summaries && summaries.length > 0) {
      const latestSummary = summaries[0];
      console.log('📚 Found relevant meeting summaries:', summaries.length);
      return res.json({
        success: true,
        reply: `Here's what I found about the ${latestSummary.metadata.client_name || ''} ${latestSummary.metadata.project_name || ''} meeting:\n\n${latestSummary.description}`,
        suggestedQuestions: [
          'Do you have any follow-up questions?',
          'Get summary for new client?',
          'Search for related meetings?'
        ],
        type: 'existing_summary',
        summaries: summaries
      });
    } else {
      return res.json({
        success: true,
        reply: "I couldn't find any relevant meeting summaries for that search. Would you like to prepare a summary for a new meeting?",
        suggestedQuestions: [
          'Get summary for new client?',
          'Search for something else?'
        ],
        type: 'no_results'
      });
    }
  } catch (error) {
    console.error('❌ Error in summary search handler:', error);
    return res.status(500).json({
      success: false,
      error: 'Summary search failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Optimized Chat endpoint with efficient routing
app.post('/api/chat', async (req, res) => {
  console.log('📝 Chat request received:', req.body);
  
  const { message, context, sessionId = 'default' } = req.body;

  if (!message) {
    return res.status(400).json({
      success: false,
      error: 'Message is required'
    });
  }

  try {
    // Route the message using our efficient router
    const route = chatRouter.route(message, sessionId);
    console.log(`🔄 Routing to: ${route} for session: ${sessionId}`);
    
    // Handle based on route
    switch (route) {
      case 'meeting_collection':
        return await handleMeetingRequest(message, context, sessionId, res, req);
      
      case 'summary_search':
        return await handleSummarySearch(message, res);
      
      case 'rag_search':
        return await handleRagQuery(message, res, sessionId);
      
      default:
        return res.status(400).json({
          success: false,
          error: 'Unknown request type'
        });
    }

  } catch (error) {
    console.error('❌ Error in chat endpoint:', error);
    
    // Clean up session on error
    clearConversationState(sessionId);
    
    return res.status(500).json({
      success: false,
      error: 'Chat processing failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Debug endpoint to check session state
app.get('/api/debug/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const isActive = isActiveSession(sessionId);
  const state = getConversationState(sessionId);
  
  res.json({
    sessionId,
    isActive,
    state: state || null
  });
});

// Clear session endpoint
app.delete('/api/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  clearConversationState(sessionId);
  res.json({ success: true, message: `Session ${sessionId} cleared` });
});




// NEW: Pipeline status tracking
let pipelineStatus = {
  running: false,
  currentMeeting: null as string | null,
  startTime: null as Date | null,
  lastUpdate: null as Date | null,
  step: null as string | null,
  error: null as string | null
};

// NEW: Pipeline status endpoint
app.get('/api/pipeline-status', (req, res) => {
  res.json({
    ...pipelineStatus,
    duration: pipelineStatus.startTime ? Date.now() - pipelineStatus.startTime.getTime() : null
  });

  
});



// NEW: Update pipeline status helper
function updatePipelineStatus(step: string, meetingName?: string, error?: string) {
  pipelineStatus.running = !error && step !== 'completed';
  pipelineStatus.currentMeeting = meetingName || pipelineStatus.currentMeeting;
  pipelineStatus.lastUpdate = new Date();
  pipelineStatus.step = step;
  pipelineStatus.error = error || null;
  
  if (step === 'started') {
    pipelineStatus.startTime = new Date();
  } else if (step === 'completed' || error) {
    // Keep the start time for duration calculation but stop the timer
  }
}

// Start the server
const PORT = process.env.PORT || 3001;
app.listen(parseInt(process.env.PORT || '3001'), async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  
  // Initialize case studies
  try {
    await loadCaseStudies();
    console.log('📚 Case studies loaded successfully');
  } catch (error) {
    console.error('❌ Error loading case studies:', error);
  }
  console.log(`📋 Available endpoints:`);
  console.log(`   GET  /api/health - Health check`);
  console.log(`   GET  /api/config-status - Check API configuration`);
  // console.log(`   GET  /api/auth-url - Get Google OAuth URL`);
  // console.log(`   GET  /api/oauth2callback - OAuth callback`);
  console.log(`   POST /api/start-pipeline - Start pipeline manually`);
  console.log(`   POST /api/chat - Optimized chat-based meeting preparation`);

  console.log(`   GET  /api/debug/session/:sessionId - Debug session state`);
  console.log(`   DELETE /api/session/:sessionId - Clear session`);
  
  // Show configuration status on startup
  console.log(`\n📊 API Configuration Status:`);
  const hasOpenAI = process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.startsWith("your_api_key");
  const hasTavily = process.env.TAVILY_API_KEY && !process.env.TAVILY_API_KEY.startsWith("your_tavily_api_key");
  const hasGemini = process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.startsWith("your_gemini_api_key");
  
  console.log(`   OpenAI: ${hasOpenAI ? '[OK] Configured' : '[X] Not configured'}`);
  console.log(`   Tavily: ${hasTavily ? '[OK] Configured' : '[X] Not configured'}`);
  console.log(`   Gemini: ${hasGemini ? '[OK] Configured' : '[X] Not configured'}`);
  

});

// Optional: Run the pipeline on startup
if (process.env.RUN_ON_STARTUP === 'true') {
  main().catch((err) => {
    console.error('❌ Error in pipeline:', err);
  });
}