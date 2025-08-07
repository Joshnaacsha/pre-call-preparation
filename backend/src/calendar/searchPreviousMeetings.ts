import { supabase } from '../supabase/client.js';
import { OpenAIEmbeddings } from '@langchain/openai';
import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";

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
  const vectorStore = await SupabaseVectorStore.fromExistingIndex(embeddings, {
    client: supabase,
    tableName: 'documents',
    queryName: 'match_events',
  });

  // Search top N (more than 3) to allow filtering
  const results = await vectorStore.similaritySearch(projectName, 10);

  // Deduplicate using a combination of summary + startTime
  const seen = new Set();
  const filtered = results.filter((result) => {
    const startTime = result.metadata?.startTime;
    const summary = result.metadata?.summary;
    const key = `${startTime}-${summary}`;

    // Exclude the current event
    if (startTime === currentStartTime) return false;

    // Skip if already seen
    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });

  return filtered.slice(0, 3);
};
