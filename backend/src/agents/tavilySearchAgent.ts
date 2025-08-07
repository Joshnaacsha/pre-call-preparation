import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import type { GraphState, RetrievedMeeting } from '../graph/graphState.js';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

// Interface for Tavily API response
interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  results: TavilySearchResult[];
}

export async function prepareTavilyInputAgent(state: GraphState): Promise<GraphState> {
  // Check if calendarEvents exists and has at least one event
  if (!state.calendarEvents || state.calendarEvents.length === 0) {
    console.warn('⚠️ No calendar events found in state.');
    return {
      ...state,
      externalResearch: {
        searchQuery: '',
        companyNews: '',
        contactUpdates: '',
      },
    };
  }

  const recentEvent = state.calendarEvents[0];

  // Check if the event has a summary
  if (!recentEvent || !recentEvent.summary) {
    console.warn('⚠️ No valid calendar event found for generating Tavily query.');
    return {
      ...state,
      externalResearch: {
        searchQuery: '',
        companyNews: '',
        contactUpdates: '',
      },
    };
  }

  // Use the full summary as the project name for better matching
  const projectName = recentEvent.summary;
  
  // Also try with cleaned version as fallback
  const cleanedProjectName = recentEvent.summary.replace(/\s*\(.*?\)\s*/g, '').trim();

  // Try to find previous meetings with exact match first, then cleaned version
  let previousMeetings: RetrievedMeeting[] = 
    state.previousMeetingsByProject?.[projectName] || 
    state.previousMeetingsByProject?.[cleanedProjectName] || 
    [];

  // Debug logging
  console.log(`🔍 DEBUG - Project extraction:`, {
    originalSummary: recentEvent.summary,
    projectName: projectName,
    cleanedProjectName: cleanedProjectName,
    availableProjects: Object.keys(state.previousMeetingsByProject || {}),
    foundPreviousMeetings: previousMeetings.length
  });

  // Create a fresh, isolated prompt with explicit context boundaries
  const prompt = `
You are an AI assistant helping a sales team prepare for external research.
This is a NEW, INDEPENDENT request. Do not use any context from previous requests or conversations.

IMPORTANT: Base your search query ONLY on the information provided below.

CURRENT PROJECT: ${projectName}
CURRENT MEETING: ${recentEvent.summary}

Given ONLY the following calendar event and previous meeting notes, create a short, specific search query suitable for a tool like Tavily.

Guidelines for search query creation:
- If the meeting title contains "Ford", create queries about Ford Motor Company
- If the meeting title contains "Meta", "Facebook", create queries about Meta/Facebook
- If the meeting title contains "Google", "GCP", create queries about Google Cloud Platform
- Focus on the actual company/technology mentioned in the meeting title
- Include relevant technical terms from the meeting description if available

Return only JSON in the format:
{
  "searchQuery": "..."
}

Current Meeting Details:
- Title: ${recentEvent.summary}
- Description: ${recentEvent.description || 'No description provided.'}
- Attendees: ${recentEvent.attendees?.join(', ') || 'No attendees listed'}

Previous Meeting Notes for THIS PROJECT ONLY:
${previousMeetings.length > 0 
  ? previousMeetings.map((m, index) => 
      `Meeting ${index + 1} (${m.metadata.summary}):
      ${m.pageContent}`
    ).join('\n\n')
  : 'No past meetings found for this project.'
}

Remember: Create a search query that is relevant to the CURRENT project "${projectName}" only.
`;

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    const raw = await result.response.text();
    const parsed = JSON.parse(
      raw.trim().replace(/^```json/, '').replace(/```$/, '')
    );

    const searchQuery = parsed.searchQuery || '';
    console.log(`🔍 Generated search query: "${searchQuery}"`);

    // Validate that the search query is relevant to the current meeting
    const isQueryRelevant = validateSearchQuery(searchQuery, recentEvent.summary);
    if (!isQueryRelevant) {
      console.warn(`⚠️ Generated query "${searchQuery}" may not be relevant to "${recentEvent.summary}"`);
    }

    // Now perform the actual Tavily search
    const searchResults = await performTavilySearch(searchQuery);
    
    // Process the search results to extract relevant information
    const processedResults = await processSearchResults(searchResults, projectName);

    return {
      ...state,
      externalResearch: {
        searchQuery,
        companyNews: processedResults.companyNews,
        contactUpdates: processedResults.contactUpdates,
      },
    };
  } catch (err) {
    console.error('❌ Failed to generate or parse Tavily input:', err);
    return {
      ...state,
      externalResearch: {
        searchQuery: '',
        companyNews: '',
        contactUpdates: '',
      },
    };
  }
}

// Function to validate if search query is relevant to the meeting
function validateSearchQuery(searchQuery: string, meetingSummary: string): boolean {
  const queryLower = searchQuery.toLowerCase();
  const summaryLower = meetingSummary.toLowerCase();
  
  // Extract key terms from meeting summary
  const keyTerms = [
    'ford', 'meta', 'facebook', 'google', 'gcp', 'aws', 'azure', 'cloud',
    'sap', 'hana', 'ecc', 's4hana', 'bigquery', 'migration'
  ];
  
  // Check if any key terms from summary appear in query
  for (const term of keyTerms) {
    if (summaryLower.includes(term) && queryLower.includes(term)) {
      return true;
    }
  }
  
  // Additional validation: check for obvious mismatches
  if (summaryLower.includes('ford') && queryLower.includes('meta')) {
    return false;
  }
  if (summaryLower.includes('meta') && queryLower.includes('ford')) {
    return false;
  }
  
  return true; // Default to true if no obvious mismatch
}

// Function to perform actual Tavily search
async function performTavilySearch(query: string): Promise<TavilySearchResult[]> {
  const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
  
  if (!TAVILY_API_KEY) {
    console.warn('⚠️ No Tavily API key found. Skipping external search.');
    return [];
  }

  if (!query || query.trim() === '') {
    console.warn('⚠️ Empty search query. Skipping external search.');
    return [];
  }

  try {
    console.log(`🌐 Performing Tavily search for: "${query}"`);
    
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query: query,
        search_depth: 'basic',
        include_answer: false,
        include_images: false,
        include_raw_content: false,
        max_results: 5,
      }),
    });

    if (!response.ok) {
      throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
    }

    const data: TavilyResponse = await response.json();
    
    console.log(`✅ Found ${data.results?.length || 0} search results`);
    
    // Log the results for debugging
    data.results?.forEach((result, index) => {
      console.log(`📰 Result ${index + 1}: ${result.title}`);
      console.log(`🔗 URL: ${result.url}`);
      console.log(`📝 Content snippet: ${result.content.slice(0, 200)}...`);
      console.log('---');
    });

    return data.results || [];
  } catch (error) {
    console.error('❌ Error performing Tavily search:', error);
    return [];
  }
}

// Function to process search results and extract relevant information
async function processSearchResults(
  results: TavilySearchResult[], 
  projectName: string
): Promise<{ companyNews: string; contactUpdates: string }> {
  if (results.length === 0) {
    return {
      companyNews: 'No external news found.',
      contactUpdates: 'No contact updates found.',
    };
  }

  // Create a fresh prompt for processing results
  const prompt = `
You are an AI assistant analyzing search results for a sales team preparing for a meeting.
This is a NEW, INDEPENDENT analysis. Do not use context from previous analyses.

CURRENT PROJECT: ${projectName}

Based ONLY on the following search results, extract and summarize:
1. Recent company news or developments relevant to the project "${projectName}"
2. Any important updates about key contacts or stakeholders

Search Results:
${results.map((result, index) => 
  `Result ${index + 1}:
  Title: ${result.title}
  URL: ${result.url}
  Content: ${result.content}
  `
).join('\n\n')}

Return only JSON in this format:
{
  "companyNews": "Brief summary of relevant company news and developments",
  "contactUpdates": "Brief summary of any contact or stakeholder updates"
}

Focus only on information relevant to "${projectName}".
`;

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    const raw = await result.response.text();
    const parsed = JSON.parse(
      raw.trim().replace(/^```json/, '').replace(/```$/, '')
    );

    console.log('📊 Processed search results:');
    console.log('🏢 Company News:', parsed.companyNews?.slice(0, 100) + '...');
    console.log('👥 Contact Updates:', parsed.contactUpdates?.slice(0, 100) + '...');

    return {
      companyNews: parsed.companyNews || 'No relevant company news found.',
      contactUpdates: parsed.contactUpdates || 'No contact updates found.',
    };
  } catch (error) {
    console.error('❌ Error processing search results:', error);
    
    // Fallback: create simple summary
    const companyNews = results
      .slice(0, 3)
      .map(r => `• ${r.title}: ${r.content.slice(0, 100)}...`)
      .join('\n');
    
    return {
      companyNews: companyNews || 'No relevant company news found.',
      contactUpdates: 'No contact updates found.',
    };
  }
}