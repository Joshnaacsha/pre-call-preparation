import dotenv from "dotenv";
import fetch from "node-fetch";
import dayjs from "dayjs";
import { OpenAI } from "openai";
import type { GraphState, CalendarEvent } from '../graph/graphState.js';

dotenv.config();

interface PersonProfile {
  email?: string;
  name?: string;
  clientName?: string;
  domain?: string;
  summary: string;
  timestamp: string;
  verified: boolean;
  sourceCount?: number;
  searchResults?: WebSearchResult[];
  inputType: 'calendar' | 'chat';
}

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  relevanceScore: number;
}

interface ChatAttendee {
  name: string;
  clientName: string;
  email?: string; // Optional for chat inputs
}

class LLMProfessionalResearcher {
  private client: OpenAI;
  private model = "gpt-4o";

  constructor(openaiApiKey: string) {
    this.client = new OpenAI({ 
      apiKey: openaiApiKey,
    });
  }

  // Main research method - handles both calendar and chat inputs
  async researchPerson(input: string | ChatAttendee, meetingContext?: { clientName?: string }): Promise<PersonProfile> {
    try {
      let searchQuery: string;
      let profile: Partial<PersonProfile> = {
        timestamp: dayjs().format("YYYY-MM-DD HH:mm:ss"),
      };

      // Determine input type and build search query
      if (typeof input === 'string') {
        if (input.includes('@')) {
          // Email input
          profile.email = input;
          profile.domain = input.split('@')[1];
          profile.inputType = 'calendar';
          searchQuery = await this.buildEmailSearchQuery(input);
          console.log(`   🔍 Researching calendar attendee (email): ${input}`);
        } else {
          // Name input with meeting context
          profile.name = input;
          profile.clientName = meetingContext?.clientName;
          profile.inputType = 'calendar';
          searchQuery = await this.buildNameClientSearchQuery(input, meetingContext?.clientName || '');
          console.log(`   🔍 Researching calendar attendee (name): ${input}${meetingContext?.clientName ? ` at ${meetingContext.clientName}` : ''}`);
        }
      } else {
        // Chat input - name and client
        profile.name = input.name;
        profile.clientName = input.clientName;
        profile.email = input.email;
        profile.inputType = 'chat';
        searchQuery = await this.buildNameClientSearchQuery(input.name, input.clientName);
        console.log(`   🔍 Researching chat attendee: ${input.name} at ${input.clientName}`);
      }

      // Step 1: Generate web search queries using LLM
      const searchQueries = await this.generateSearchQueries(searchQuery);
      
      // Step 2: Simulate web search results (you'll need to replace this with actual web search)
      const searchResults = await this.performWebSearch(searchQueries);
      
      // Step 3: Use LLM to analyze search results and generate professional summary
      const aiSummary = await this.generateLLMSummary(profile, searchResults, searchQuery);
      
      // Step 4: Determine verification status based on search results quality
      const isVerified = this.determineVerificationStatus(searchResults, aiSummary);

      return {
        ...profile,
        summary: aiSummary,
        verified: isVerified,
        sourceCount: searchResults.length,
        searchResults: searchResults,
      } as PersonProfile;

    } catch (error: any) {
      console.error(`   ❌ Error researching: ${error.message}`);
      const identifier = typeof input === 'string' ? input : `${input.name} at ${input.clientName}`;
      
      return {
        email: typeof input === 'string' ? input : input.email,
        name: typeof input === 'string' ? undefined : input.name,
        clientName: typeof input === 'string' ? undefined : input.clientName,
        domain: typeof input === 'string' ? input.split('@')[1] : undefined,
        summary: `Research failed: ${error.message}`,
        timestamp: dayjs().format("YYYY-MM-DD HH:mm:ss"),
        verified: false,
        inputType: typeof input === 'string' ? 'calendar' : 'chat',
      };
    }
  }

  private async buildEmailSearchQuery(email: string): Promise<string> {
    const domain = email.split('@')[1];
    const localPart = email.split('@')[0];
    
    // Try to extract name from email
    const possibleName = localPart
      .replace(/[._-]/g, ' ')
      .replace(/\d+/g, '')
      .trim();

    return `"${email}" OR "${possibleName}" site:linkedin.com OR site:${domain} professional profile contact`;
  }

  private async buildNameClientSearchQuery(name: string, clientName: string): Promise<string> {
    // Add variations of company name to improve matches
    const companyVariations = [
      clientName,
      clientName.replace(/\s+/g, ''), // Remove spaces
      clientName.replace(/[-_\s]/g, ' ') // Replace special chars with spaces
    ];
    
    return `"${name}" (${companyVariations.map(v => `"${v}"`).join(' OR ')}) linkedin professional profile employee contact`;
  }

  private async generateSearchQueries(baseQuery: string): Promise<string[]> {
  // Extract name and company from baseQuery if possible
  let name = '';
  let company = '';
  const nameMatch = baseQuery.match(/"([^"]+)"/);
  if (nameMatch) name = nameMatch[1];
  const companyMatch = baseQuery.match(/"([^"]+)"\s+"([^"]+)"/);
  if (companyMatch) company = companyMatch[2];

  const prompt = `
Generate 3-4 diverse web search queries to find professional information about a person. 
Ask it to search through linkedIn profiles as well. Base query: ${baseQuery}

IMPORTANT: Every query MUST include the exact full name ("${name}") and company ("${company}") in quotes, with no variations or substitutions. Do NOT use similar names or abbreviations. Do not use initials. Do not use alternate spellings. Do not use only the first or last name. Always use both the full name and company in every query.

Create variations that search different platforms and aspects:
1. LinkedIn/professional networks
2. Company websites/employee directories  
3. Industry publications/news
4. Professional achievements/speaking

Return only the search queries, one per line, no numbering or extra text.
Keep queries concise (5-8 words each).
`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "system",
            content: "You are a search query optimization expert. Generate diverse, effective web search queries."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.4,
        max_tokens: 200,
      });

      const queries = response.choices[0]?.message?.content
        ?.split('\n')
        .filter(q => q.trim().length > 0)
        .map(q => q.trim()) || [baseQuery];

      return queries.slice(0, 4);
    } catch (error) {
      console.warn('Failed to generate search queries, using base query');
      return [baseQuery];
    }
  }

  private async performWebSearch(queries: string[]): Promise<WebSearchResult[]> {
    // Use only the first query for real web search
    const query = queries[0];
    try {
      // Use OpenAI Responses API for real web search
      // @ts-ignore: responses is available in OpenAI SDK >= 4.x
      const response = await this.client.responses.create({
        model: this.model,
        tools: [
          { type: "web_search" }
        ],
        input: query,
      });

      // Try to extract citations if present, else use output_text
      let results: WebSearchResult[] = [];
      if (Array.isArray((response as any).citations)) {
        results = (response as any).citations.map((c: any, idx: number) => ({
          title: c.title || c.url || `Result #${idx + 1}`,
          url: c.url,
          snippet: c.snippet || c.content || '',
          relevanceScore: 1.0 - idx * 0.1
        }));
      } else if (typeof (response as any).output_text === 'string') {
        // Fallback: treat output_text as a single result
        results = [{
          title: 'Web Search Result',
          url: '',
          snippet: (response as any).output_text,
          relevanceScore: 1.0
        }];
      }

      if (results.length > 0) {
        const concise = results.map((r, idx) => `#${idx + 1}: ${r.title} (${r.url})`).join('\n');
        console.log(`[OpenAI Web Search Results] ${concise}`);
      } else {
        console.log('[OpenAI Web Search Results] No results found.');
      }

      return results.slice(0, 10);
    } catch (error) {
      console.warn('OpenAI web search failed:', error);
      return [];
    }
  }

  private async generateLLMSummary(
    profile: Partial<PersonProfile>,
    searchResults: WebSearchResult[],
    originalQuery: string
  ): Promise<string> {
    const searchContext = searchResults
      .map(result => `**${result.title}**\n${result.snippet}\nSource: ${result.url}`)
      .join('\n\n');

    const prompt = this.buildLLMAnalysisPrompt(profile, searchContext, originalQuery);

    const chatResponse = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content: "You are a professional researcher that synthesizes web search results to provide actionable meeting preparation intelligence. Focus on verified, professional information only."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 1200,
    });

    return chatResponse.choices[0]?.message?.content || "AI summary generation failed.";
  }

  private buildLLMAnalysisPrompt(
    profile: Partial<PersonProfile>,
    searchContext: string,
    originalQuery: string
  ): string {
    const identifier = profile.email || `${profile.name} at ${profile.clientName}`;
    const inputType = profile.inputType;

    return `
Analyze web search results and create professional intelligence for: ${identifier}
Input Type: ${inputType === 'calendar' ? 'Calendar Email' : 'Chat Module (Name + Client)'}

**WEB SEARCH RESULTS:**
${searchContext}

**ANALYSIS INSTRUCTIONS:**
1. Extract ONLY verified professional information from the search results above
2. Focus on current role, company, and recent professional activities
3. If search results are insufficient or unclear, clearly state "Limited verified information available"
4. Prioritize recent information (last 2-3 years)
5. Do not speculate beyond what's provided in search results

**RESPONSE FORMAT:**

**PROFESSIONAL PROFILE SUMMARY**
• Full Name: [extract from search results or indicate unknown]
• Current Position: [from search results]
• Company: [current employer from search results]
• Industry/Sector: [business context]
• Location: [if mentioned in professional context]

**CURRENT ROLE & RESPONSIBILITIES**
• Key Areas: [extract from search results]
• Department/Team: [if mentioned]
• Experience Level: [based on available information]
• Technologies/Skills: [if mentioned in results]

**PROFESSIONAL CONTEXT**
• Recent Activities: [from search results - conferences, publications, etc.]
• Company Information: [size, focus, recent news if available]
• Industry Position: [if determinable from results]

**MEETING PREPARATION INSIGHTS**
• Likely Expertise Areas: [based on role and activities]
• Potential Discussion Topics: [relevant to their role]
• Decision-Making Level: [assess based on position]
• Communication Approach: [suggest based on role level]

**INFORMATION CONFIDENCE**
• Search Results Quality: [assess relevance and recency]
• Verification Level: [high/medium/low based on source quality]
• Information Gaps: [note missing key details]

**DATA SOURCES**
• Total Sources Found: ${searchContext ? searchContext.split('**').length - 1 : 0}
• Primary Platforms: [LinkedIn, company sites, industry publications, etc.]

If search results provide insufficient information, respond with:
"**LIMITED VERIFIED INFORMATION AVAILABLE**
Web search for ${identifier} yielded limited professional details.
Available context: [summarize any useful information found]
Recommendation: Prepare general discussion topics for the meeting."

Keep response concise but comprehensive (max 800 words).
Focus on actionable intelligence for business meeting preparation.
`;
  }

  private determineVerificationStatus(
    searchResults: WebSearchResult[],
    summary: string
  ): boolean {
    // Check if we have any search results
    if (searchResults.length === 0) return false;
    
    // Check the quality of our best result (first one has highest relevance)
    const bestResult = searchResults[0];
    const resultText = `${bestResult.title} ${bestResult.snippet}`.toLowerCase();
    
    // If our best result is from a professional profile site and contains role info
    const isProfessionalSite = resultText.includes('linkedin') || 
                              resultText.includes('signalhire') || 
                              resultText.includes('professional') ||
                              resultText.includes('employee');
                              
    const hasRoleInfo = resultText.includes('position') || 
                       resultText.includes('role') || 
                       resultText.includes('associate') || 
                       resultText.includes('manager') || 
                       resultText.includes('engineer') ||
                       resultText.includes('director');
    
    // Consider verified if we have at least one good quality result
    if (isProfessionalSite && hasRoleInfo) return true;
    
    // Fall back to checking summary only if we couldn't verify from results
    if (summary.includes("LIMITED VERIFIED INFORMATION AVAILABLE")) return false;
    if (summary.includes("insufficient information")) return false;
    
    // If summary has good information, consider it verified
    return !summary.toLowerCase().includes("limited") && 
           !summary.toLowerCase().includes("insufficient");
  }

  // Additional utility methods

  async searchByName(name: string, company?: string): Promise<PersonProfile> {
    const chatAttendee: ChatAttendee = {
      name: name,
      clientName: company || 'Unknown Company'
    };
    return this.researchPerson(chatAttendee);
  }

  async searchByEmail(email: string): Promise<PersonProfile> {
    return this.researchPerson(email);
  }
}

// Main function for calendar-based research (email inputs)
export async function conductLLMResearch(state: GraphState): Promise<GraphState> {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  
  if (!openaiApiKey || openaiApiKey.startsWith("your_api_key")) {
    console.warn('⚠️ OPENAI_API_KEY not configured - skipping research');
    return {
      ...state,
      externalResearch: {
        contactUpdates: 'Research skipped - OpenAI API key not configured',
        searchQuery: 'Research skipped - API key not configured',
      }
    };
  }

  if (!state.calendarEvents || state.calendarEvents.length === 0) {
    console.warn('⚠️ No calendar events found for research');
    return state;
  }

  const currentEvent = state.calendarEvents[0];
  const researcher = new LLMProfessionalResearcher(openaiApiKey);
  
  console.log('🤖 Starting LLM-based professional research...');
  console.log(`   📧 Meeting attendees: ${currentEvent.attendees.length}`);

  // Filter attendees - skip internal emails
  const internalDomains = ['cprime.com', 'licet.ac.in']; // Add your internal domains
  const externalAttendees = currentEvent.attendees.filter(email => 
    !internalDomains.some(domain => email.toLowerCase().includes(domain.toLowerCase()))
  );
  
  const internalAttendees = currentEvent.attendees.filter(email => 
    internalDomains.some(domain => email.toLowerCase().includes(domain.toLowerCase()))
  );

  console.log(`   👥 External attendees to research: ${externalAttendees.length}`);
  console.log(`   🏢 Internal attendees (skipped): ${internalAttendees.length}`);

  if (externalAttendees.length === 0) {
    console.log('   ✅ No external attendees to research');
    return {
      ...state,
      externalResearch: {
        contactUpdates: 'No external attendees found for research',
        searchQuery: `LLM research: ${currentEvent.summary}`,
      }
    };
  }

  const profiles: PersonProfile[] = [];
  
  // Research each external attendee
  for (const attendee of externalAttendees.slice(0, 8)) { // Limit for API costs
    try {
      // Extract client name from event - normalize to handle different meeting topics
      const fullSummary = currentEvent.summary.toLowerCase();
      // Get everything before the first delimiter and clean it
      const rawClientName = fullSummary.split(/[-:]/)[0].trim();
      // Further clean the client name to handle variations
      const clientName = rawClientName
        .replace(/\s*(platform|infrastructure|solution|discussion|meeting|call)\s*.*/g, '')
        .trim();
      
      console.log(`🔍 Extracted client name: "${clientName}" from summary: "${fullSummary}"`);
      const meetingContext = { clientName };
      
      const profile = await researcher.researchPerson(attendee, meetingContext);
      profiles.push(profile);
      
      if (profile.verified) {
        console.log(`   ✅ Research completed: ${attendee} (LLM + Web Search)`);
      } else {
        console.log(`   ⚠️ Limited info found: ${attendee}`);
      }
      
      // Rate limiting for web searches
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error(`   ❌ Failed to research ${attendee}:`, error);
    }
  }

  // Generate consolidated research summary
  const researchSummary = generateLLMResearchSummary(profiles, currentEvent);
  
  console.log(`✅ LLM research completed: ${profiles.length} profiles researched`);
  console.log(`   📊 Verified profiles: ${profiles.filter(p => p.verified).length}`);

  return {
    ...state,
    externalResearch: {
      contactUpdates: researchSummary,
      searchQuery: state.externalResearch?.searchQuery || `LLM research: ${currentEvent.summary}`,
    }
  };
}

// Function for chat-based research (name + client inputs)
export async function conductChatLLMResearch(attendees: ChatAttendee[]): Promise<PersonProfile[]> {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  
  if (!openaiApiKey || openaiApiKey.startsWith("your_api_key")) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const researcher = new LLMProfessionalResearcher(openaiApiKey);
  const profiles: PersonProfile[] = [];
  
  console.log('🤖 Starting LLM-based chat research...');
  console.log(`   👥 Chat attendees to research: ${attendees.length}`);

  for (const attendee of attendees.slice(0, 8)) { // Limit for API costs
    try {
      const profile = await researcher.researchPerson(attendee);
      profiles.push(profile);
      
      if (profile.verified) {
        console.log(`   ✅ Research completed: ${attendee.name} at ${attendee.clientName}`);
      } else {
        console.log(`   ⚠️ Limited info found: ${attendee.name} at ${attendee.clientName}`);
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error(`   ❌ Failed to research ${attendee.name}:`, error);
    }
  }

  console.log(`✅ Chat LLM research completed: ${profiles.length} profiles researched`);
  return profiles;
}

function generateLLMResearchSummary(profiles: PersonProfile[], event: CalendarEvent): string {
  const verifiedProfiles = profiles.filter(p => p.verified);
  const unverifiedCount = profiles.length - verifiedProfiles.length;

  if (verifiedProfiles.length === 0) {
    return `LLM-based research conducted for ${profiles.length} attendee(s) - limited verified data available. Meeting: ${event.summary}`;
  }

  let summary = `MEETING INTELLIGENCE (${verifiedProfiles.length}/${profiles.length} profiles verified)\n`;
  summary += `Powered by LLM + Web Search Analysis\n\n`;

  verifiedProfiles.forEach((profile) => {
    const identifier = profile.email || `${profile.name} at ${profile.clientName}`;
    summary += `${identifier}\n`;
    // Extract key information from the AI summary
    const keyInfo = extractLLMInsights(profile.summary);
    keyInfo.forEach(info => {
      summary += `- ${info}\n`;
    });
  // Removed source count line from summary as requested
    summary += '\n';
  });

  if (unverifiedCount > 0) {
    summary += `Note: ${unverifiedCount} additional attendee(s) researched with limited verified data.\n\n`;
  }

  summary += generateLLMMeetingContextSuggestions(verifiedProfiles);

  summary += `\nResearch completed: ${dayjs().format("MMM DD, YYYY HH:mm")} | Method: LLM + Web Search Analysis`;

  return summary;
}

function extractLLMInsights(summary: string): string[] {
  const insights: string[] = [];
  
  // Extract role information
  const roleMatch = summary.match(/Current Position:\s*([^\n•]+)/i);
  if (roleMatch) insights.push(`Role: ${roleMatch[1].trim()}`);
  
  // Extract company information
  const companyMatch = summary.match(/Company:\s*([^\n•]+)/i);
  if (companyMatch) insights.push(`Company: ${companyMatch[1].trim()}`);
  
  // Extract industry
  const industryMatch = summary.match(/Industry[\/\w]*:\s*([^\n•]+)/i);
  if (industryMatch) insights.push(`Industry: ${industryMatch[1].trim()}`);
  
  // Extract expertise areas
  const expertiseMatch = summary.match(/Expertise Areas?:\s*([^\n•]+)/i);
  if (expertiseMatch) insights.push(`Expertise: ${expertiseMatch[1].trim()}`);
  
  return insights.slice(0, 4); // Keep it concise
}

function generateLLMMeetingContextSuggestions(profiles: PersonProfile[]): string {
  const companies = new Set<string>();
  const industries = new Set<string>();
  const roles = new Set<string>();
  
  profiles.forEach(profile => {
    // Extract company info
    const companyMatch = profile.summary.match(/Company:\s*([^\n•]+)/i);
    if (companyMatch) companies.add(companyMatch[1].trim());
    
    // Extract industry info  
    const industryMatch = profile.summary.match(/Industry[\/\w]*:\s*([^\n•]+)/i);
    if (industryMatch) industries.add(industryMatch[1].trim());
    
    // Extract role level
    const roleMatch = profile.summary.match(/Current Position:\s*([^\n•]+)/i);
    if (roleMatch) {
      const role = roleMatch[1].toLowerCase();
      if (role.includes('director') || role.includes('vp') || role.includes('chief')) {
        roles.add('Executive Level');
      } else if (role.includes('manager') || role.includes('lead')) {
        roles.add('Management');
      } else {
        roles.add('Individual Contributor');
      }
    }
  });
  
  let suggestions = '**STRATEGIC MEETING APPROACH**\n';
  
  if (companies.size > 0) {
    suggestions += `• Organizations: ${Array.from(companies).slice(0, 3).join(', ')}\n`;
  }
  
  if (industries.size > 0) {
    suggestions += `• Industries: ${Array.from(industries).join(', ')}\n`;
  }
  
  if (roles.size > 0) {
    suggestions += `• Audience Level: ${Array.from(roles).join(', ')}\n`;
  }
  
  suggestions += `• Verified Intelligence: ${profiles.filter(p => p.verified).length} comprehensive profiles\n`;
  
  return suggestions;
}

// Helper functions for standalone testing
export async function runStandaloneLLMResearch(email: string): Promise<PersonProfile> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }
  
  const researcher = new LLMProfessionalResearcher(apiKey);
  return await researcher.researchPerson(email);
}

export async function runStandaloneChatResearch(name: string, clientName: string): Promise<PersonProfile> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }
  
  const researcher = new LLMProfessionalResearcher(apiKey);
  const attendee: ChatAttendee = { name, clientName };
  return await researcher.researchPerson(attendee);
}

// Export the main class and types
export { LLMProfessionalResearcher, type PersonProfile, type ChatAttendee, type WebSearchResult };