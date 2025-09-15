import type { GraphState } from '../graph/graphState.js';

// This function expects an Express request object with session middleware
export async function authorizeAndListEvents(req: any, listEventsWithToken: (accessToken: string) => Promise<GraphState>): Promise<GraphState> {
  // Check for Microsoft Graph access token in session
  const accessToken = req.session?.accessToken;
  if (accessToken) {
    // Use the provided function to list events with the access token
    return await listEventsWithToken(accessToken);
  } else {
    console.log('⚠️  No Microsoft Graph access token found. User must log in.');
    return {
      calendarEvents: [],
      externalResearch: {
        searchQuery: '',
        companyNews: '',
        contactUpdates: '',
      },
    };
  }
}