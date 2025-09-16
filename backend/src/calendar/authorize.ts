import type { GraphState } from '../graph/graphState.js';
import TokenService from '../services/token.js';

// This function expects an Express request object with session middleware
export async function authorizeAndListEvents(req: any, listEventsWithToken: (accessToken: string) => Promise<GraphState>): Promise<GraphState> {
  try {
    // Enhanced session checking with logging
    console.log('Checking session state:', {
      hasSession: !!req.session,
      sessionContent: req.session ? Object.keys(req.session) : [],
      userEmail: req.session?.userEmail || 'not found'
    });

    // Check for user email in session
    const userEmail = req.session?.userEmail;
    if (!userEmail) {
      console.log('⚠️  No user email found in session. User must log in.');
      console.log('Session details:', {
        sessionID: req.sessionID,
        sessionKeys: req.session ? Object.keys(req.session) : [],
        sessionData: req.session || 'No session'
      });
      return getEmptyState();
    }

    // Get fresh access token
    console.log(`📝 Fetching token for user: ${userEmail}`);
    const tokenService = await TokenService;
    const tokens = await tokenService.refreshTokenIfNeeded(userEmail);
    
    // Use the fresh access token to list events
    console.log('🔑 Got fresh access token, fetching events...');
    const events = await listEventsWithToken(tokens.accessToken);
    console.log(`📅 Found ${events.calendarEvents?.length || 0} events`);
    
    return events;
  } catch (error) {
    console.error('Authorization error:', error instanceof Error ? error.message : 'Unknown error');
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
    return getEmptyState();
  }
}

function getEmptyState(): GraphState {
  return {
    calendarEvents: [],
    externalResearch: {
      searchQuery: '',
      companyNews: '',
      contactUpdates: '',
    },
  };
}