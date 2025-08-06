import { supabase } from '../supabase/client.js';

// Type definitions
interface MeetingEntities {
  companies: string[];
  baseProject: string;
  keywords: string[];
}

interface SearchStrategy {
  type: string;
  patterns: string[];
}

interface MeetingResult {
  content: string;
  metadata: any;
  strategy?: string;
  relevanceScore?: number;
  start_time: string;
}

interface DiagnosticResult {
  totalMeetings: number;
  extractedEntities: MeetingEntities;
  strategiesCount: number;
  potentialMatches: Array<{
    summary: string;
    startTime: string;
    commonCompanies: string[];
    commonKeywords: string[];
  }>;
  error?: string;
}

/**
 * Enhanced company/project extraction with better accuracy and generic term filtering
 * @param {string} summary - Meeting summary
 * @returns {MeetingEntities} - Extracted entities with confidence scores
 */
const extractMeetingEntities = (summary: string): MeetingEntities => {
  const original = summary.toLowerCase().trim();
  
  // Known company patterns (expanded list)
  const knownCompanies = [
    'ford', 'meta', 'google', 'pepsico', 'nvidia', 'nividia', 'microsoft', 
    'amazon', 'apple', 'broadcom', 'target', 'nestle', 'oracle', 'salesforce',
    'ibm', 'cisco', 'intel', 'amd', 'qualcomm', 'adobe'
  ];
  
  // Extract potential companies from known list
  const companies: string[] = [];
  for (const company of knownCompanies) {
    if (original.includes(company)) {
      companies.push(company);
    }
  }
  
  // If no known companies, try to extract meaningful company names (avoid generic terms)
  if (companies.length === 0) {
    const cleaned = original
      .replace(/\b(meeting|call|discussion|session|sync|standup|review|kickoff|client|customer|with|the|and|for)\b/gi, '')
      .replace(/[-\s]+/g, ' ')
      .trim();
    
    const words = cleaned.split(' ').filter(word => 
      word.length > 3 && // Longer than 3 characters
      !['meeting', 'call', 'client', 'customer', 'discussion', 'session'].includes(word.toLowerCase()) &&
      !/^\d+$/.test(word) // Not just numbers
    );
    
    // Only add if it looks like a company name (first word, proper length)
    if (words.length > 0 && words[0].length > 3) {
      companies.push(words[0]);
    }
  }
  
  // Extract base project (remove " - X" suffix)
  const baseProject = summary.replace(/\s*-\s*\d+$/, '').trim();
  
  // Extract meaningful keywords (filter out very common terms)
  const commonStopWords = [
    'the', 'and', 'for', 'with', 'our', 'new', 'from', 'meeting', 
    'call', 'client', 'customer', 'discussion', 'session', 'sync'
  ];
  
  const keywords = original
    .replace(/[-\d]/g, ' ')
    .split(/\s+/)
    .filter(word => 
      word.length > 2 && 
      !commonStopWords.includes(word.toLowerCase())
    )
    .filter((word, index, arr) => arr.indexOf(word) === index); // Remove duplicates
  
  return { companies, baseProject, keywords };
};

/**
 * Generate comprehensive search strategies with company-first approach
 * @param {string} projectName - Original meeting name
 * @returns {SearchStrategy[]} - Search strategies with different approaches
 */
const generateSearchStrategies = (projectName: string): SearchStrategy[] => {
  const entities = extractMeetingEntities(projectName);
  const strategies: SearchStrategy[] = [];
  
  // Strategy 1: Company-specific matching (HIGHEST PRIORITY)
  // Only search for meetings with the specific company
  entities.companies.forEach(company => {
    if (company !== 'client' && company !== 'meeting') { // Avoid generic terms
      strategies.push({
        type: 'company_specific',
        patterns: [
          `${company}%`,
          `%${company}%`,
          `${company} %`,
          `% ${company}%`
        ]
      });
    }
  });
  
  // Strategy 2: Exact base project matching (only if no generic terms)
  if (entities.baseProject !== projectName && !entities.baseProject.toLowerCase().includes('client meeting')) {
    strategies.push({
      type: 'exact_base',
      patterns: [
        `${entities.baseProject} - %`,
        `${entities.baseProject}-%`,
        `${entities.baseProject.replace(/\s+/g, ' ')} - %`
      ]
    });
  }
  
  // Strategy 3: Specific keyword matching (exclude generic terms)
  if (entities.keywords.length > 0) {
    const specificKeywords = entities.keywords.filter(keyword => 
      !['client', 'meeting', 'call', 'discussion', 'session'].includes(keyword.toLowerCase()) &&
      keyword.length > 3
    );
    
    if (specificKeywords.length > 0) {
      const topKeywords = specificKeywords.slice(0, 2); // Use top 2 specific keywords
      strategies.push({
        type: 'specific_keywords',
        patterns: topKeywords.map(keyword => `%${keyword}%`)
      });
    }
  }
  
  // Strategy 4: Lenient matching (only if company found and not generic)
  if (entities.companies.length > 0 && entities.companies.some(c => c !== 'client' && c !== 'meeting')) {
    const lenientPattern = projectName
      .replace(/[-\d]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\b(client|meeting|call)\b/gi, '') // Remove generic terms
      .trim();
    
    if (lenientPattern && lenientPattern.length > 3) {
      strategies.push({
        type: 'lenient_specific',
        patterns: [`%${lenientPattern}%`]
      });
    }
  }
  
  return strategies;
};

/**
 * Enhanced deduplication with company-first relevance scoring
 * @param {MeetingResult[]} results - Raw search results
 * @param {string} originalProject - Original project name
 * @returns {MeetingResult[]} - Deduplicated and scored results
 */
const deduplicateAndScore = (results: MeetingResult[], originalProject: string): MeetingResult[] => {
  const seen = new Set<string>();
  const unique: MeetingResult[] = [];
  
  const originalEntities = extractMeetingEntities(originalProject);
  
  for (const result of results) {
    const metadata = typeof result.metadata === 'string' ? JSON.parse(result.metadata) : result.metadata;
    const summary = metadata.summary;
    
    // Skip duplicates
    if (seen.has(summary)) {
      continue;
    }
    seen.add(summary);
    
    // Calculate relevance score with company-first approach
    const resultEntities = extractMeetingEntities(summary);
    let score = 0;
    
    // Company matching (HIGHEST weight - only specific companies, not generic terms)
    const specificCompanies = originalEntities.companies.filter(c => 
      c !== 'client' && c !== 'meeting' && c.length > 3
    );
    const commonSpecificCompanies = specificCompanies.filter(company => 
      resultEntities.companies.includes(company)
    );
    score += commonSpecificCompanies.length * 10; // Much higher weight for company matches
    
    // Penalize generic matches if no specific company match
    if (commonSpecificCompanies.length === 0) {
      // Check if this is just a generic "client meeting" match
      const isGenericMatch = (
        summary.toLowerCase().includes('client meeting') &&
        !specificCompanies.some(company => summary.toLowerCase().includes(company))
      );
      
      if (isGenericMatch) {
        score -= 5; // Heavily penalize generic matches
      }
    }
    
    // Base project matching (only if meaningful)
    const cleanOriginalBase = originalEntities.baseProject.toLowerCase().replace(/\b(client|meeting)\b/g, '').trim();
    const cleanResultBase = resultEntities.baseProject.toLowerCase().replace(/\b(client|meeting)\b/g, '').trim();
    
    if (cleanOriginalBase.length > 3 && cleanResultBase.length > 3 && 
        cleanOriginalBase === cleanResultBase) {
      score += 5;
    }
    
    // Specific keyword matching (exclude generic terms)
    const specificOriginalKeywords = originalEntities.keywords.filter(k => 
      !['client', 'meeting', 'call', 'discussion'].includes(k.toLowerCase()) && k.length > 3
    );
    const specificResultKeywords = resultEntities.keywords.filter(k => 
      !['client', 'meeting', 'call', 'discussion'].includes(k.toLowerCase()) && k.length > 3
    );
    
    const commonSpecificKeywords = specificOriginalKeywords.filter(keyword =>
      specificResultKeywords.includes(keyword)
    );
    score += commonSpecificKeywords.length * 2;
    
    // Strategy bonus (company-specific strategies get higher scores)
    if (result.strategy === 'company_specific') score += 3;
    if (result.strategy === 'exact_base') score += 2;
    if (result.strategy === 'specific_keywords') score += 1;
    
    // Recency bonus (more recent meetings get slight boost)
    const daysDiff = (Date.now() - new Date(result.start_time).getTime()) / (1000 * 60 * 60 * 24);
    score += Math.max(0, (30 - daysDiff) / 30); // Boost for meetings within 30 days
    
    // Only include results with meaningful relevance scores
    if (score > 0 || commonSpecificCompanies.length > 0) {
      unique.push({
        ...result,
        relevanceScore: score
      });
    }
  }
  
  // Sort by relevance score and limit results
  const sortedResults = unique
    .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
    .slice(0, 10); // Return top 10 most relevant meetings
  
  // Filter out very low relevance generic matches if we have high-relevance specific matches
  const hasHighRelevanceMatches = sortedResults.some(r => (r.relevanceScore || 0) > 5);
  
  if (hasHighRelevanceMatches) {
    return sortedResults.filter(r => (r.relevanceScore || 0) > 1); // Filter out low-relevance generic matches
  }
  
  return sortedResults;
};

/**
 * Execute search with multiple strategies and combine results
 * @param {string} projectName - Project name to search
 * @param {string} currentStartTime - Current meeting start time
 * @returns {Promise<Array>} - Combined and deduplicated results
 */
export const searchPreviousMeetings = async (
  projectName: string,
  currentStartTime: string
): Promise<Array<{pageContent: string, metadata: any, relevanceScore?: number}>> => {
  try {
    console.log(`   🔍 Searching previous meetings for "${projectName}"...`);
    
    const strategies = generateSearchStrategies(projectName);
    console.log(`   🎯 Using ${strategies.length} search strategies`);
    
    let allResults: MeetingResult[] = [];
    let totalFound = 0;
    
    // Execute each strategy
    for (const strategy of strategies) {
      console.log(`   🔍 Trying ${strategy.type} strategy...`);
      
      for (const pattern of strategy.patterns) {
        try {
          // Use ILIKE for case-insensitive partial matching
          const { data, error } = await supabase
            .from('documents')
            .select('*')
            .ilike('metadata->>summary', pattern)
            .neq('metadata->>startTime', currentStartTime)
            .order('start_time', { ascending: false })
            .limit(20); // Increased limit to catch more results
          
          if (error) {
            console.warn(`   ⚠️  Error with pattern "${pattern}":`, error.message);
            continue;
          }
          
          if (data && data.length > 0) {
            console.log(`   ✅ Found ${data.length} meetings with ${strategy.type} pattern: "${pattern}"`);
            allResults.push(...data.map(doc => ({ ...doc, strategy: strategy.type })));
            totalFound += data.length;
          }
        } catch (patternError: unknown) {
          const errorMessage = patternError instanceof Error ? patternError.message : 'Unknown error';
          console.warn(`   ⚠️  Pattern execution error for "${pattern}":`, errorMessage);
        }
      }
    }
    
    console.log(`   📊 Total raw results: ${totalFound}`);
    
    // Enhanced deduplication and scoring
    const uniqueResults = deduplicateAndScore(allResults, projectName);
    
    console.log(`   📚 Found ${uniqueResults.length} related previous meetings`);
    
    // Log found meetings for debugging
    if (uniqueResults.length > 0) {
      uniqueResults.forEach((doc, i) => {
        const metadata = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : doc.metadata;
        const score = doc.relevanceScore || 0;
        console.log(`   ${i + 1}. "${metadata.summary}" (${metadata.startTime}) [Score: ${score.toFixed(2)}]`);
      });
    }
    
    // Transform to expected format
    return uniqueResults.map(doc => ({
      pageContent: doc.content,
      metadata: typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : doc.metadata,
      relevanceScore: doc.relevanceScore
    }));
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Error in searchPreviousMeetings:', errorMessage);
    return [];
  }
};

/**
 * Diagnostic function to understand why meetings might be missed
 * @param {string} projectName - Project name
 * @param {string} currentStartTime - Current meeting time
 * @returns {Promise<DiagnosticResult>} - Diagnostic information
 */
export const diagnoseMeetingSearch = async (
  projectName: string, 
  currentStartTime: string
): Promise<DiagnosticResult> => {
  try {
    console.log(`\n🔍 DIAGNOSTIC: Analyzing search for "${projectName}"`);
    
    // Get all meetings from the database
    const { data: allMeetings, error } = await supabase
      .from('documents')
      .select('*')
      .neq('metadata->>startTime', currentStartTime)
      .order('start_time', { ascending: false });
    
    if (error) {
      console.error('❌ Diagnostic error:', error);
      return { 
        totalMeetings: 0,
        extractedEntities: { companies: [], baseProject: '', keywords: [] },
        strategiesCount: 0,
        potentialMatches: [],
        error: error.message 
      };
    }
    
    const entities = extractMeetingEntities(projectName);
    const strategies = generateSearchStrategies(projectName);
    
    console.log(`📊 Total meetings in database: ${allMeetings?.length || 0}`);
    console.log(`🎯 Extracted entities:`, entities);
    console.log(`🔍 Generated strategies:`, strategies.length);
    
    // Analyze which meetings should match but don't
    const analysis: DiagnosticResult = {
      totalMeetings: allMeetings?.length || 0,
      extractedEntities: entities,
      strategiesCount: strategies.length,
      potentialMatches: []
    };
    
    if (allMeetings) {
      for (const meeting of allMeetings) {
        const metadata = typeof meeting.metadata === 'string' ? JSON.parse(meeting.metadata) : meeting.metadata;
        const meetingEntities = extractMeetingEntities(metadata.summary);
        
        // Check for potential matches
        const hasCommonCompany = entities.companies.some(company => 
          meetingEntities.companies.includes(company)
        );
        const hasCommonKeywords = entities.keywords.some(keyword =>
          meetingEntities.keywords.includes(keyword)
        );
        
        if (hasCommonCompany || hasCommonKeywords) {
          analysis.potentialMatches.push({
            summary: metadata.summary,
            startTime: metadata.startTime,
            commonCompanies: entities.companies.filter(c => meetingEntities.companies.includes(c)),
            commonKeywords: entities.keywords.filter(k => meetingEntities.keywords.includes(k))
          });
        }
      }
    }
    
    console.log(`🎯 Found ${analysis.potentialMatches.length} potential matches`);
    analysis.potentialMatches.forEach((match, i) => {
      console.log(`   ${i + 1}. "${match.summary}" - Companies: [${match.commonCompanies.join(', ')}], Keywords: [${match.commonKeywords.join(', ')}]`);
    });
    
    return analysis;
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Diagnostic error:', errorMessage);
    return {
      totalMeetings: 0,
      extractedEntities: { companies: [], baseProject: '', keywords: [] },
      strategiesCount: 0,
      potentialMatches: [],
      error: errorMessage
    };
  }
};

/**
 * Legacy function for backward compatibility
 * @param {string} projectName - Meeting name
 * @param {string} currentStartTime - Current meeting start time
 * @returns {Promise<Array>} - Previous meetings
 */
export const searchPreviousMeetingsSimple = async (
  projectName: string,
  currentStartTime: string
): Promise<Array<{pageContent: string, metadata: any}>> => {
  try {
    const companyName = extractMeetingEntities(projectName).companies[0];
    console.log(`   🔍 Simple search for company: "${companyName}"`);
    
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .ilike('metadata->>summary', `%${companyName}%`)
      .neq('metadata->>startTime', currentStartTime)
      .order('start_time', { ascending: false })
      .limit(5);

    if (error) {
      console.error('❌ Simple search error:', error);
      return [];
    }

    console.log(`   📚 Simple search found ${data?.length || 0} meetings`);
    
    return data?.map((doc: any) => ({
      pageContent: doc.content,
      metadata: JSON.parse(doc.metadata)
    })) || [];
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Error in simple search:', errorMessage);
    return [];
  }
};