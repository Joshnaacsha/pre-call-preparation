import { supabase } from '../supabase/client.js';
import { OpenAIEmbeddings } from '@langchain/openai';

interface SearchResult {
  id: number;
  summary: string;
  description: string;
  start_time: Date;
  attendees: string[];
  location: string;
  content: string;
  embedding: number[];
  metadata: {
    client_name: string;
    project_name: string;
    meeting_goal?: string;
    summary: string;
  };
  similarity: number;
}

interface ConvertedResult {
  metadata: {
    summary: string;
    startTime: string;
    client_name: string;
    project_name: string;
  };
  pageContent: string;
}

const embeddings = new OpenAIEmbeddings();

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Search previous meetings excluding the current one by startTime
 * @param {string} projectName - Project name to search with
 * @param {string} currentStartTime - ISO start time of the current meeting
 * @returns {Promise<Array>} - Top 3 similar meetings excluding the current
 */
export const searchPreviousMeetings = async (
  projectName: string,
  currentStartTime: string
) => {

  // First, get a broader set of potential matches
  let { data: initialResults, error: initialError } = await supabase
    .from('meetings')
    .select('*')
    .lt('meeting_date', currentStartTime)
    .order('meeting_date', { ascending: false })
    .limit(50);  // Get a larger initial set for semantic analysis

  if (initialError) {
    console.error('Error in initial search:', initialError);
    return [];
  }


  // Use LLM embeddings to compare both client and project name for fuzzy matching
  const currentMeetingString = `Client: ${projectName}`;
  const currentEmbedding = await embeddings.embedQuery(currentMeetingString);

  // Calculate semantic similarity for each previous meeting (client+project)
  const scoredResults = await Promise.all(
    (initialResults || []).map(async (result) => {
      const prevMeetingString = `Client: ${result.metadata?.client_name || ''}, Project: ${result.metadata?.project_name || ''}`;
      const prevEmbedding = await embeddings.embedQuery(prevMeetingString);
      const similarity = cosineSimilarity(currentEmbedding, prevEmbedding);
      return {
        ...result,
        semanticScore: similarity
      };
    })
  );

  // Lower semantic threshold for candidate pool
  const candidateResults = scoredResults
    .filter(result => result.semanticScore > 0.80)
    .sort((a, b) => b.semanticScore - a.semanticScore)
    .slice(0, 20);

  // Use LLM to check if company names refer to the same company
  const { OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  async function isSameCompany(nameA: string, nameB: string): Promise<boolean> {
    if (!nameA || !nameB) return false;
    if (nameA.trim().toLowerCase() === nameB.trim().toLowerCase()) return true;
    const prompt = `Are the following two company names referring to the same company?\n\nName 1: ${nameA}\nName 2: ${nameB}\n\nAnswer only 'yes' or 'no'.`;
    try {
      const resp = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 3
      });
      const answer = resp.choices[0]?.message?.content?.toLowerCase() || '';
      return answer.includes('yes');
    } catch (err) {
      console.error('LLM company match error:', err);
      return false;
    }
  }

  // Filter candidates using LLM for company name match
  const fuzzyRelevantResults = [];
  for (const result of candidateResults) {
    const prevName = result.metadata?.client_name || '';
    const isMatch = await isSameCompany(projectName, prevName);
    if (isMatch) fuzzyRelevantResults.push(result);
  }

  if (fuzzyRelevantResults.length === 0) {
    console.log(`No previous meetings found for client (LLM match): ${projectName}`);
    return [];
  }

  console.log(`🔍 Found ${fuzzyRelevantResults.length} LLM-matched meetings for client: ${projectName}`);
  // Convert relevant results to the expected format, with safe date handling
  const converted = fuzzyRelevantResults.map((result: SearchResult): ConvertedResult => {
    // Ensure metadata exists
    if (!result.metadata) {
      result.metadata = {
        client_name: 'Unknown Client',
        project_name: projectName || 'Unknown Project',
        summary: result.summary || ''
      };
    }
    // Safely handle the date conversion
    let startTime = '';
    try {
      if (result.start_time instanceof Date) {
        startTime = result.start_time.toISOString();
      } else if (typeof result.start_time === 'string') {
        startTime = new Date(result.start_time).toISOString();
      } else {
        startTime = new Date().toISOString(); // Fallback to current date if invalid
      }
    } catch (error) {
      console.warn(`Invalid date for meeting: ${result.summary}`);
      startTime = new Date().toISOString(); // Fallback to current date
    }

    return {
      metadata: {
        summary: result.summary,
        startTime,
        client_name: result.metadata.client_name,
        project_name: result.metadata.project_name
      },
      pageContent: result.content
    };
  });

  // Deduplicate using a combination of summary + startTime
  const seen = new Set<string>();
  const filtered = converted.filter((result: ConvertedResult) => {
    const key = `${result.metadata.startTime}-${result.metadata.summary}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return filtered.slice(0, 3);
};
