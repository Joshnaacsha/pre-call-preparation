import OpenAI from 'openai';
import dotenv from 'dotenv';
import type { GraphState, RetrievedMeeting } from '../graph/graphState.js';
import pLimit from 'p-limit';
import * as fs from 'fs/promises';
import * as path from 'path';

// Load case studies
let cprimeStudies: any[] = [];
let inryStudies: any[] = [];

export async function loadCaseStudies() {
  try {
    // Use src/data directory directly
    const srcDataPath = path.resolve(process.cwd(), 'src', 'data');
    const cprimeStudiesPath = path.resolve(srcDataPath, 'case_studies_complete_final.json');
    const inryStudiesPath = path.resolve(srcDataPath, 'inry_complete_cases.json');
    
    console.log('📂 Attempting to load case studies from:');
    console.log('   - Cprime:', cprimeStudiesPath);
    console.log('   - INRY:', inryStudiesPath);

    // Check if files exist
    try {
      await fs.access(cprimeStudiesPath);
      await fs.access(inryStudiesPath);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ One or more case study files not found:', errorMessage);
      console.log('🔍 Current directory:', srcDataPath);
      throw new Error('Case study files not found');
    }
    
    cprimeStudies = JSON.parse(await fs.readFile(cprimeStudiesPath, 'utf-8'));
    inryStudies = JSON.parse(await fs.readFile(inryStudiesPath, 'utf-8'));
    
    console.log(`📚 Successfully loaded case studies:`);
    console.log(`   - Cprime: ${cprimeStudies.length} studies`);
    console.log(`   - INRY: ${inryStudies.length} studies`);
    
    // Log sample entries to verify content
    if (cprimeStudies.length > 0) {
      console.log('📄 Sample Cprime case study:', {
        title: cprimeStudies[0].title,
        industry: cprimeStudies[0].industry || cprimeStudies[0]['Industry/Sector'] || 'Unknown',
        tags: cprimeStudies[0].tags?.slice(0, 3) || []
      });
    }
    
    if (inryStudies.length > 0) {
      console.log('📄 Sample INRY case study:', {
        title: inryStudies[0].title,
        industry: inryStudies[0].industry_sector || inryStudies[0]['Industry/Sector'] || 'Unknown',
        technologies: inryStudies[0].key_technologies_used?.slice(0, 3) || []
      });
    }
  } catch (error) {
    console.error('❌ Error loading case studies:', error);
  }
}

// Load case studies on module initialization
loadCaseStudies();

// Type definitions for sales intelligence
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CaseStudy {
  title: string;
  industry: string;
  technologies: string[];
  description: string;
  url: string;
  source?: string;
  relevanceScore: number;
  relevance_reasoning: string;
  tags?: string[];
}

export interface KeyStakeholder {
  name: string;
  title: string;
  focus_area: string;
}

export interface SalesIntelligenceReport {
  companyName: string;
  executiveSummary: string;
  financialPerformance: string;
  leadershipOrganization: string;
  strategicInitiatives: string;
  challengesPainPoints: string;
  marketPosition: string;
  salesOpportunities: string;
  riskFactors: string;
  keyStakeholders: KeyStakeholder[];
  recommendedApproach: string;
  confidenceScore: number;
  citations: string[];
}

dotenv.config();

// Helper function to extract company name from meeting summary
function extractCompanyName(summary: string): string {
  // Common company identifiers in meeting titles
  const companyPatterns = [
    /(?:meeting with|call with|discussion with)\s+([A-Z][A-Za-z0-9\s&]+?)(?:\s+team|\s+about|\s+-|$)/i,
    /([A-Z][A-Za-z0-9\s&]+?)(?:\s+meeting|\s+call|\s+discussion|\s+-)/i,
    /([A-Z][A-Za-z0-9\s&]+?)(?:\s+Project|\s+Initiative)/i
  ];

  for (const pattern of companyPatterns) {
    const match = summary.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  // Fallback: return first capitalized word sequence
  const fallbackMatch = summary.match(/([A-Z][A-Za-z0-9\s&]+)/);
  return fallbackMatch ? fallbackMatch[1].trim() : summary;
}

// Generate comprehensive research queries for a company
function generateResearchQueries(companyName: string): string[] {
  return [
    // Financial Deep Dive
    `${companyName} Q3 Q4 2024 earnings revenue growth margins profit forecast`,
    `${companyName} financial performance market position 2024`,
    
    // Leadership & Strategy
    `${companyName} CEO executive leadership team changes announcements`,
    `${companyName} strategic initiatives priorities 2024 2025`,
    
    // Technology & Digital
    `${companyName} technology infrastructure cloud digital transformation`,
    `${companyName} IT modernization software development priorities`,
    
    // Market Position
    `${companyName} market share competitive position industry analysis`,
    `${companyName} competitors comparison strengths weaknesses`,
    
    // Business Development
    `${companyName} partnerships acquisitions strategic alliances`,
    `${companyName} growth strategy expansion plans announcements`
  ];
}

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

// Helper function to verify case studies are loaded
async function verifyCaseStudies(): Promise<boolean> {
  if (cprimeStudies.length === 0 && inryStudies.length === 0) {
    console.log('⚠️ No case studies loaded, attempting to load...');
    await loadCaseStudies();
  }
  return cprimeStudies.length > 0 || inryStudies.length > 0;
}

export async function prepareTavilyInputAgent(state: GraphState): Promise<GraphState> {
  // Verify case studies are loaded
  await verifyCaseStudies();
  
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

  // Extract company name from summary
  const projectName = recentEvent.summary;
  const companyName = extractCompanyName(recentEvent.summary);
  
  // Generate research queries
  const researchQueries = generateResearchQueries(companyName);

  // Debug logging
  console.log(`🔍 DEBUG - Project extraction:`, {
    originalSummary: recentEvent.summary,
    projectName: projectName,
    companyName: companyName,
    queriesGenerated: researchQueries.length
  });

  // Create comprehensive research prompt
  const prompt = `
You are a senior business intelligence analyst helping a sales team prepare for a client meeting.
This is a NEW, INDEPENDENT request focused on comprehensive company research.

COMPANY: ${companyName}
MEETING CONTEXT: ${recentEvent.summary}
${recentEvent.description ? `MEETING DETAILS: ${recentEvent.description}` : ''}

ANALYSIS REQUIREMENTS:
1. Financial Performance & Health (revenue, growth, margins)
2. Leadership & Organization (key executives, structure)
3. Technology Infrastructure & Strategy
4. Market Position & Competition
5. Strategic Initiatives & Priorities
6. Business Challenges & Opportunities

Current Meeting Details:
- Title: ${recentEvent.summary}
- Description: ${recentEvent.description || 'No description provided.'}
- Attendees: ${recentEvent.attendees?.join(', ') || 'No attendees listed'}

Return a JSON object with:
{
  "searchQuery": "primary search query",
  "additionalQueries": ["query1", "query2"...]
}

Focus on information that would be valuable for enterprise sales professionals.
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
export async function findRelevantCaseStudies(projectName: string, results: SearchResult[]): Promise<CaseStudy[]> {
  console.log(`🔍 Searching for relevant case studies for: ${projectName}`);
  console.log(`📊 Available case studies:`,
    `\n   - Cprime: ${cprimeStudies.length} studies`,
    `\n   - INRY: ${inryStudies.length} studies`);
  
  // Extract key topics and technologies from search results
  const content = results.map(r => r.content).join(' ');
  
  // Create prompt to analyze the content and find relevant case studies
  const prompt = `
Analyze the following search results about "${projectName}" and identify key industry, technologies, and challenges:

${content}

Extract:
1. Industry/sector
2. Key technologies mentioned
3. Business challenges
4. Digital transformation goals
`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    });

    const analysis = completion.choices[0].message.content || '';
    
    // Score case studies based on relevance
    const scoredCprimeStudies = cprimeStudies.map(study => ({
      ...study,
      relevanceScore: calculateRelevanceScore(study, analysis),
      relevance_reasoning: generateRelevanceReasoning(study, analysis)
    }));

    const scoredInryStudies = inryStudies.map(study => ({
      ...study,
      relevanceScore: calculateRelevanceScore(study, analysis),
      relevance_reasoning: generateRelevanceReasoning(study, analysis)
    }));

    // Combine and sort by relevance
    const allStudies = [...scoredCprimeStudies, ...scoredInryStudies]
      .filter(study => study.relevanceScore > 0.6)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 5);

    return allStudies;
  } catch (error) {
    console.error('❌ Error finding relevant case studies:', error);
    return [];
  }
}

function calculateRelevanceScore(study: any, analysis: string): number {
  const analysisLower = analysis.toLowerCase();
  const studyContent = `${study.title} ${study.description} ${study.industry} ${(study.tags || []).join(' ')}`.toLowerCase();
  
  // Calculate relevance based on content overlap
  let score = 0;
  
  // Industry match
  if (study.industry && analysisLower.includes(study.industry.toLowerCase())) {
    score += 0.3;
  }
  
  // Technology match
  const techMatches = (study.tags || []).filter((tag: string) => 
    analysisLower.includes(tag.toLowerCase())
  );
  score += (techMatches.length * 0.2);
  
  // Challenge/solution match
  if (study.description && 
      analysisLower.split(' ').some(word => 
        study.description.toLowerCase().includes(word) &&
        word.length > 4 // Only consider significant words
      )) {
    score += 0.3;
  }
  
  return Math.min(1, score);
}

function generateRelevanceReasoning(study: any, analysis: string): string {
  const matches = [];
  
  if (study.industry) {
    matches.push(`Same industry sector: ${study.industry}`);
  }
  
  const techMatches = (study.tags || []).filter((tag: string) => 
    analysis.toLowerCase().includes(tag.toLowerCase())
  );
  if (techMatches.length > 0) {
    matches.push(`Matching technologies: ${techMatches.join(', ')}`);
  }
  
  if (matches.length === 0) {
    matches.push('Similar business challenges and transformation goals');
  }
  
  return matches.join('. ');
}

export async function processSearchResults(
  results: SearchResult[], 
  projectName: string
): Promise<{ companyNews: string; contactUpdates: string; salesIntelligence: Partial<SalesIntelligenceReport> }> {
  if (results.length === 0) {
    return {
      companyNews: 'No external news found.',
      contactUpdates: 'No contact updates found.',
      salesIntelligence: {
        companyName: projectName,
        confidenceScore: 0,
        citations: []
      }
    };
  }

  // Create a fresh prompt for processing results
  const prompt = `
You are a senior business intelligence analyst synthesizing research for a sales team.
Create a comprehensive analysis from the following search results.

TARGET COMPANY: ${projectName}

ANALYZE AND STRUCTURE THE FOLLOWING INFORMATION:
${results.map((result, index) => 
  `SOURCE ${index + 1}:
  Title: ${result.title}
  URL: ${result.url}
  Published: ${result.publishedAt || 'Unknown date'}
  Content: ${result.content}
  `
).join('\n\n')}

Return a JSON object with the following structure:
{
  "companyNews": "Latest relevant news summary",
  "contactUpdates": "Key stakeholder/contact updates",
  "salesIntelligence": {
    "executiveSummary": "2-3 sentence strategic overview",
    "financialPerformance": "Key financial metrics and trends",
    "leadershipOrganization": "Leadership team insights",
    "strategicInitiatives": "Major company initiatives and priorities",
    "challengesPainPoints": "Known business challenges",
    "marketPosition": "Competitive position analysis",
    "salesOpportunities": "Potential sales angles",
    "riskFactors": "Key business risks",
    "keyStakeholders": [
      {
        "name": "Executive Name",
        "title": "Role",
        "focus_area": "Area of responsibility"
      }
    ],
    "recommendedApproach": "Suggested sales strategy",
    "confidenceScore": 0.85
  }
}

Focus on actionable intelligence for sales teams.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });

    const raw = completion.choices[0].message.content || '{}';
    let parsed;
    
    // Multi-stage JSON parsing with detailed error handling
    try {
      // Stage 1: Try to parse the raw content directly
      parsed = JSON.parse(raw.trim());
      
      // Stage 2: Validate basic structure and required fields
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid JSON structure - not an object');
      }
      
      // Stage 3: Check for markdown code blocks if direct parsing failed
      if (!parsed.companyNews && !parsed.contactUpdates) {
        const jsonMatch = raw.match(/```(?:json)?([\\s\\S]*?)```/) || raw.match(/({[\\s\\S]*})/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1].trim());
        }
      }
      
      // Stage 4: Validate and sanitize fields
      parsed = {
        companyNews: typeof parsed.companyNews === 'string' ? parsed.companyNews : 'No company news available.',
        contactUpdates: typeof parsed.contactUpdates === 'string' ? parsed.contactUpdates : 'No contact updates available.',
        salesIntelligence: {
          ...(parsed.salesIntelligence || {}),
          executiveSummary: typeof parsed.salesIntelligence?.executiveSummary === 'string' 
            ? parsed.salesIntelligence.executiveSummary 
            : 'Executive summary not available.',
          financialPerformance: typeof parsed.salesIntelligence?.financialPerformance === 'string'
            ? parsed.salesIntelligence.financialPerformance
            : 'Financial data not available.',
          // Ensure other required fields have defaults
          companyName: projectName,
          confidenceScore: typeof parsed.salesIntelligence?.confidenceScore === 'number' 
            ? parsed.salesIntelligence.confidenceScore 
            : 0.5,
          citations: Array.isArray(parsed.salesIntelligence?.citations) 
            ? parsed.salesIntelligence.citations 
            : []
        }
      };
    } catch (error) {
      // If that fails, try to extract JSON from markdown code blocks
      try {
        const jsonMatch = raw.match(/```(?:json)?([\\s\\S]*?)```/) || raw.match(/({[\\s\\S]*})/);
        if (!jsonMatch) {
          throw new Error('Failed to extract JSON from response');
        }
        parsed = JSON.parse(jsonMatch[1].trim());
      } catch (error) {
        console.error('Failed to parse response:', error);
        parsed = {
          companyNews: 'Error extracting company news.',
          contactUpdates: 'Error extracting contact updates.',
          salesIntelligence: {
            companyName: projectName,
            confidenceScore: 0,
            citations: []
          }
        };
      }
    }

    console.log('📊 Processed search results:');
    console.log('🏢 Company News:', parsed.companyNews?.slice(0, 100) + '...');
    console.log('👥 Contact Updates:', parsed.contactUpdates?.slice(0, 100) + '...');

        // Find relevant case studies
    const relevantCaseStudies = await findRelevantCaseStudies(projectName, results);
    
    // Split into Cprime and INRY case studies
    const cprimeRelevantStudies = relevantCaseStudies.filter(study => 
      study.source === 'Cprime' || study.source?.includes('cprime.com')
    );
    const inryRelevantStudies = relevantCaseStudies.filter(study => 
      study.source === 'INRY' || study.source?.includes('inry.com')
    );

    return {
      companyNews: parsed.companyNews || 'No relevant company news found.',
      contactUpdates: parsed.contactUpdates || 'No contact updates found.',
      salesIntelligence: {
        ...parsed.salesIntelligence,
        companyName: projectName,
        citations: results.map(r => r.url).filter(Boolean),
        confidenceScore: parsed.salesIntelligence?.confidenceScore || 0.7,
        cprimeCaseStudies: cprimeRelevantStudies,
        inryCaseStudies: inryRelevantStudies
      }
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
      salesIntelligence: {
        companyName: projectName,
        executiveSummary: `Analysis based on ${results.length} recent sources about ${projectName}`,
        confidenceScore: 0.5,
        citations: results.map(r => r.url).filter(Boolean)
      }
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