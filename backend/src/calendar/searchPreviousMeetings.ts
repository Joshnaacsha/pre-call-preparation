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
 * Search previous meetings excluding the current one by startTime
 * @param {string} projectName - Project name to search with
 * @param {string} currentStartTime - ISO start time of the current meeting
 * @returns {Promise<Array>} - Top 3 similar meetings excluding the current
 */
export const searchPreviousMeetings = async (
  projectName: string,
  currentStartTime: string
) => {
  // Use direct Supabase query with vector search
  const queryEmbedding = await embeddings.embedQuery(projectName);

  const { data: results, error } = await supabase
    .rpc('match_events', {
      query_embedding: queryEmbedding,
      match_threshold: 0.5,
      match_count: 10,
      exclude_date: currentStartTime
    });

  if (error) {
    console.error('Error searching previous meetings:', error);
    return [];
  }

  // Convert results to the expected format
  const converted = (results || []).map((result: SearchResult): ConvertedResult => ({
    metadata: {
      summary: result.summary,
      startTime: result.start_time instanceof Date ? result.start_time.toISOString() : new Date(result.start_time).toISOString(),
      client_name: result.metadata.client_name,
      project_name: result.metadata.project_name
    },
    pageContent: result.content
  }));

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
