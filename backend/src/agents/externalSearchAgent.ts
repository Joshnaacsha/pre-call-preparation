import OpenAI from 'openai';
import dotenv from 'dotenv';
import type { GraphState, RetrievedMeeting } from '../graph/graphState.js';
import pLimit from 'p-limit';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Rate limiter: max 2 concurrent requests, 1 request per 500ms
const rateLimiter = pLimit(2);
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 500; // 500ms between requests

// Simple in-memory cache (replace with Redis/Supabase for production)
interface CacheEntry {
  results: SearchResult[];
  timestamp: number;
  expiresAt: number;
}

const searchCache = new Map<string, CacheEntry>();
const CACHE_EXPIRY_HOURS = 6;

// Enhanced search result interface
export interface SearchResult {
  title: string;
  url: string;
  content: string;
  publishedAt?: string;
  source?: string;
  score?: number;
}

// Backup search options (if OpenAI web search fails)

// Option 1: Keep using Tavily as fallback
export async function performTavilySearch(query: string): Promise<SearchResult[]> {
  const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
  
  if (!TAVILY_API_KEY) {
    console.warn('⚠️ No Tavily API key found');
    return [];
  }

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

    const data = await response.json();
    return data.results?.map((result: any) => ({
      title: result.title,
      url: result.url,
      content: result.content,
      publishedAt: result.published_date,
      source: result.source
    })) || [];
  } catch (error) {
    console.error('❌ Tavily error:', error);
    return [];
  }
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
    console.warn('⚠️ No valid calendar event found for generating search query.');
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

Given ONLY the following calendar event and previous meeting notes, create a short, specific search query suitable for web search.

Guidelines for search query creation:
- If the meeting title contains "Ford", create queries about Ford Motor Company
- If the meeting title contains "Meta", "Facebook", create queries about Meta/Facebook
- If the meeting title contains "Google", "GCP", create queries about Google Cloud Platform
- Focus on the actual company/technology mentioned in the meeting title
- Include relevant technical terms from the meeting description if available
- Keep queries concise and focused (3-8 words)

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
    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });

    const raw = completion.choices[0].message.content || '';
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

    // Now perform the actual OpenAI web search with fallback
    const searchResults = await performOpenAIWebSearchWithFallback(searchQuery);
    
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
    console.error('❌ Failed to generate or parse search input:', err);
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

// Enhanced cache key generation
function generateCacheKey(query: string): string {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return `${query.toLowerCase().trim()}:${today}`;
}

// Check if cache entry is valid
function isCacheValid(entry: CacheEntry): boolean {
  return Date.now() < entry.expiresAt;
}

// Cleanup expired cache entries
function cleanupCache(): void {
  const now = Date.now();
  for (const [key, entry] of searchCache.entries()) {
    if (now >= entry.expiresAt) {
      searchCache.delete(key);
    }
  }
}

// Rate limiting helper
async function enforceRateLimit(): Promise<void> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    console.log(`⏱️ Rate limiting: waiting ${waitTime}ms`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  lastRequestTime = Date.now();
}

// Function to perform OpenAI web search using responses API with proper citation handling
export async function performOpenAIWebSearch(query: string): Promise<SearchResult[]> {
  if (!query || query.trim() === '') {
    console.warn('⚠️ Empty search query. Skipping external search.');
    return [];
  }

  // Check cache first
  const cacheKey = generateCacheKey(query);
  const cachedEntry = searchCache.get(cacheKey);
  
  if (cachedEntry && isCacheValid(cachedEntry)) {
    console.log(`💾 Using cached results for query: "${query}"`);
    return cachedEntry.results;
  }

  // Cleanup expired cache entries periodically
  if (searchCache.size > 100) {
    cleanupCache();
  }

  return rateLimiter(async () => {
    try {
      console.log(`🌐 Performing OpenAI web search for: "${query}"`);
      
      // Enforce rate limiting
      await enforceRateLimit();

      // CRITICAL: Ask for citations explicitly in the prompt
      const enhancedQuery = `${query}. Please include citations and links in your response.`;

      // Use OpenAI Responses API for real web search
      // @ts-ignore: responses is available in OpenAI SDK >= 4.x
      const response = await openai.responses.create({
        model: "gpt-4o",
        tools: [
          { type: "web_search" }
        ],
        input: enhancedQuery,
      });

      interface WebSearchResponse {
        content?: string;
        tool_calls?: Array<{
          function: {
            arguments: string;
          };
        }>;
        citations?: Array<{
          title?: string;
          url?: string;
          snippet?: string;
          content?: string;
          published_date?: string;
          source?: string;
        }>;
      }

      let results: SearchResult[] = [];

      // Try to extract citations if present, else use output_text
      if (Array.isArray((response as any).citations)) {
        results = (response as any).citations.map((c: any, idx: number) => ({
          title: c.title || c.url || `Result #${idx + 1}`,
          url: c.url || '',
          content: c.snippet || c.content || '',
          publishedAt: c.published_date,
          source: c.source || 'Web Search',
          score: 1.0 - idx * 0.1
        }));
      } else if (typeof (response as any).output_text === 'string') {
        const outputText = (response as any).output_text;
        
        // Try to split into multiple results based on common separators
        const sections: string[] = outputText.split(/(?:\r?\n){2,}|\d+\.\s+(?=[A-Z])/);
        
        results = sections
          .filter((section: string) => section.trim().length > 50) // Only meaningful sections
          .map((section: string, idx: number) => {
            const lines = section.split('\n');
            let title = `Search Result ${idx + 1}`;
            let content = section;

            // Try to extract title from first line if it looks like a heading
            if (lines[0] && lines[0].trim().length > 0 && lines[0].trim().length < 100) {
              title = lines[0].trim().replace(/^[#\s*-]+|[\s*-]+$/g, '');
              content = lines.slice(1).join('\n').trim();
            }

            // Extract URLs if present in the content
            const urlMatch = content.match(/https?:\/\/[^\s)]+/);
            const url = urlMatch ? urlMatch[0] : '';

            return {
              title: title,
              url: url,
              content: content,
              publishedAt: new Date().toISOString(),
              source: 'OpenAI Search',
              score: 1.0 - (idx * 0.1) // Decrease score for later results
            };
          });
      }
      // Last resort: return empty to trigger fallback
      else {
        console.log('⚠️ No citations or URLs found in OpenAI response');
        return [];
      }

      // Filter out results with no meaningful content
      results = results.filter(result => 
        result.content && 
        result.content.length > 10 && 
        result.title !== 'undefined'
      );

      if (results.length > 0) {
        const concise = results.map((r, idx) => `#${idx + 1}: ${r.title} (${r.url || 'no URL'})`).join('\n');
        console.log(`[OpenAI Web Search Results] ${concise}`);
      } else {
        console.log('[OpenAI Web Search Results] No valid results found after filtering.');
        return [];
      }

      // Limit to top 10 results before additional filtering
      results = results.slice(0, 10);

      console.log(`📊 Found ${results.length} raw search results`);

      // Apply filters (date, duplicates, etc.)
      results = filterSearchResults(results);
      
      console.log(`✅ After filtering: ${results.length} results remain`);

      // Cache the results only if we have meaningful results
      if (results.length > 0) {
        const expiresAt = Date.now() + (CACHE_EXPIRY_HOURS * 60 * 60 * 1000);
        searchCache.set(cacheKey, {
          results,
          timestamp: Date.now(),
          expiresAt
        });
      }

      // Log the results for debugging
      results.forEach((result, index) => {
        console.log(`📰 Result ${index + 1}: ${result.title}`);
        console.log(`🔗 URL: ${result.url || 'No URL'}`);
        console.log(`📅 Published: ${result.publishedAt || 'Recent'}`);
        console.log(`📝 Content snippet: ${result.content.slice(0, 150)}...`);
        console.log('---');
      });

      return results;
    } catch (error) {
      console.error('❌ Error performing OpenAI web search:', error);
      console.error('❌ Error details:', error instanceof Error ? error.message : 'Unknown error');
      
      // If we have a cached entry (even expired), use it as fallback
      if (cachedEntry) {
        console.log('🔄 Using expired cache as fallback');
        return cachedEntry.results;
      }
      
      return [];
    }
  });
}

// Enhanced search function with better fallback logic
export async function performOpenAIWebSearchWithFallback(query: string): Promise<SearchResult[]> {
  try {
    console.log(`🔍 Starting search for: "${query}"`);
    
    // Try OpenAI web search first
    const openaiResults = await performOpenAIWebSearch(query);
    
    // Check if we got meaningful results from OpenAI
    const meaningfulResults = openaiResults.filter(result => 
      (result.url || result.content) && // Accept results with either URL or content
      result.content.length > 50 // Just ensure we have substantial content
    );
    
    if (meaningfulResults.length > 0) {
      console.log(`✅ OpenAI web search successful: ${meaningfulResults.length} meaningful results`);
      return meaningfulResults;
    } else {
      console.log(`⚠️ OpenAI returned ${openaiResults.length} results but none were meaningful. Trying Tavily fallback...`);
      const tavilyResults = await performTavilySearch(query);
      
      if (tavilyResults.length > 0) {
        console.log(`✅ Tavily fallback successful: ${tavilyResults.length} results`);
        return tavilyResults;
      } else {
        console.log(`⚠️ Both OpenAI and Tavily failed. Returning any available results.`);
        return openaiResults; // Return whatever we got, even if not ideal
      }
    }
  } catch (error) {
    console.error('❌ All web search methods failed:', error);
    
    // Try Tavily as last resort
    try {
      console.log('🔄 Emergency fallback to Tavily...');
      return await performTavilySearch(query);
    } catch (fallbackError) {
      console.error('❌ Emergency fallback also failed:', fallbackError);
      return [];
    }
  }
}

// Enhanced filtering function
function filterSearchResults(results: SearchResult[]): SearchResult[] {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Step 1: Filter by date (keep only results ≤ 7 days old)
  let filtered = results.filter(result => {
    if (!result.publishedAt) {
      // If no publish date, keep it but log
      console.log(`📅 No publish date for: ${result.title} - keeping it`);
      return true;
    }

    try {
      const publishDate = new Date(result.publishedAt);
      const isRecent = publishDate >= sevenDaysAgo;
      
      if (!isRecent) {
        console.log(`📅 Filtering out old result: ${result.title} (${result.publishedAt})`);
      }
      
      return isRecent;
    } catch (error) {
      console.warn(`📅 Invalid date format for ${result.title}: ${result.publishedAt}`);
      return true; // Keep if we can't parse the date
    }
  });

  // Step 2: Remove duplicates based on URL and title similarity
  filtered = removeDuplicates(filtered);

  // Step 3: Keep only top 3 results
  filtered = filtered.slice(0, 3);

  return filtered;
}

// Function to remove duplicates
function removeDuplicates(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];

  for (const result of results) {
    // Create a key based on URL and normalized title
    const normalizedTitle = result.title.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const key = `${result.url}|${normalizedTitle}`;

    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(result);
    } else {
      console.log(`🔄 Removing duplicate: ${result.title}`);
    }
  }

  return deduped;
}

// Enhanced relevance checking function
export async function checkResultRelevance(
  results: SearchResult[], 
  originalQuery: string
): Promise<SearchResult[]> {
  if (results.length === 0) return results;

  const prompt = `
Given the search query "${originalQuery}", assess the relevance of each search result.
Return only the results that are directly relevant to the query.

Rate each result's relevance on a scale of 1-5:
- 5: Highly relevant and directly related
- 4: Mostly relevant with good connection
- 3: Somewhat relevant
- 2: Loosely related
- 1: Not relevant

Only keep results with a score of 3 or higher.

Results to evaluate:
${results.map((r, i) => `${i + 1}. Title: ${r.title}\nContent: ${r.content.slice(0, 200)}...`).join('\n\n')}

Return JSON format:
{
  "relevantResults": [
    {
      "index": 0,
      "score": 4,
      "reason": "Brief explanation why it's relevant"
    }
  ]
}
`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    });

    const raw = completion.choices[0].message.content || '';
    const parsed = JSON.parse(
      raw.trim().replace(/^```json/, '').replace(/```$/, '')
    );

    const relevantIndices = parsed.relevantResults
      ?.filter((r: any) => r.score >= 3)
      ?.map((r: any) => r.index) || [];

    const filteredResults = results.filter((_, index) => 
      relevantIndices.includes(index)
    );

    console.log(`🎯 Relevance filtering: kept ${filteredResults.length}/${results.length} results`);
    
    return filteredResults;
  } catch (error) {
    console.error('❌ Error checking result relevance:', error);
    return results; // Return original results if relevance check fails
  }
}

// Function to process search results and extract relevant information
export async function processSearchResults(
  results: SearchResult[], 
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
  Published: ${result.publishedAt || 'Unknown date'}
  Content: ${result.content}
  `
).join('\n\n')}

Return only JSON in this format:
{
  "companyNews": "Brief summary of relevant company news and developments",
  "contactUpdates": "Brief summary of any contact or stakeholder updates"
}

Focus only on information relevant to "${projectName}".
If no relevant information is found, return "No relevant [news/updates] found."
`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });

    const raw = completion.choices[0].message.content || '';
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
      .map(r => `• ${r.title} (${r.publishedAt || 'Recent'}): ${r.content.slice(0, 100)}...`)
      .join('\n');
    
    return {
      companyNews: companyNews || 'No relevant company news found.',
      contactUpdates: 'No contact updates found.',
    };
  }
}

// Helper function to parse web citations from response text
function parseWebCitationsFromText(text: string, originalQuery: string): SearchResult[] {
  const results: SearchResult[] = [];
  
  // Look for URLs in the text
  const urlRegex = /https?:\/\/[^\s\)]+/g;
  const urls = text.match(urlRegex) || [];
  
  // Look for citation patterns like [1], (1), etc.
  const citationRegex = /\[(\d+)\]|\((\d+)\)/g;
  const citations = [...text.matchAll(citationRegex)];
  
  console.log(`🔍 DEBUG - Found ${urls.length} URLs and ${citations.length} citation markers in text`);
  
  // Create results from URLs found
  urls.forEach((url, index) => {
    // Try to extract title from surrounding text
    const urlIndex = text.indexOf(url);
    const contextBefore = text.substring(Math.max(0, urlIndex - 100), urlIndex).trim();
    const contextAfter = text.substring(urlIndex + url.length, urlIndex + url.length + 100).trim();
    
    // Extract potential title from context
    const titleMatch = contextBefore.match(/([A-Z][^.!?]*[.!?])\s*$/) || 
                      contextAfter.match(/^[^.!?]*\./) ||
                      [null, `Search result for "${originalQuery}"`];
    
    const title = titleMatch[1]?.replace(/[.!?]$/, '').trim() || `Web Search Result #${index + 1}`;
    const content = `${contextBefore} ${contextAfter}`.trim() || `Information related to ${originalQuery}`;
    
    results.push({
      title: title,
      url: url,
      content: content,
      publishedAt: new Date().toISOString(),
      source: 'OpenAI Web Search',
    });
  });
  
  // If no URLs found but text mentions sources, create a general result
  if (results.length === 0 && text.length > 100) {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
    const firstSentences = sentences.slice(0, 3).join('. ');
    
    results.push({
      title: `Information about ${originalQuery}`,
      url: '',
      content: firstSentences,
      publishedAt: new Date().toISOString(),
      source: 'OpenAI Web Search Summary',
    });
  }
  
  return results.slice(0, 5); // Limit to 5 results
}
export function getCacheStats() {
  cleanupCache();
  return {
    totalEntries: searchCache.size,
    oldestEntry: Math.min(...Array.from(searchCache.values()).map(e => e.timestamp)),
    newestEntry: Math.max(...Array.from(searchCache.values()).map(e => e.timestamp)),
  };
}

// Utility function to clear cache manually
export function clearCache() {
  searchCache.clear();
  console.log('🧹 Search cache cleared');
}