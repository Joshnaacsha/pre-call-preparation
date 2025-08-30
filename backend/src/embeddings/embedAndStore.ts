import { OpenAIEmbeddings } from '@langchain/openai';
import { supabase } from '../supabase/client.js';
import { CalendarEvent, GraphState } from '../graph/graphState';

const embeddings = new OpenAIEmbeddings();

export interface StoredDocument {
  summary: string;
  description: string;  // Will contain the full AI-generated summary
  start_time: string;
  attendees: string[];
  location: string;
  content: string;
  embedding?: number[];
  metadata: {
    summary: string;
    startTime: string;
    location: string;
    client_name?: string;
    project_name?: string;
    meeting_goal?: string;
    raw_summary?: any;  // Store the structured JSON response from Gemini
  };
  raw_summary?: any;  // For backward compatibility
}

export async function embedAndStoreEvent(event: CalendarEvent & { metadata?: any, description?: string }) {
  const contentToEmbed = `${event.summary}\n${event.description || ''}\n${event.location}\n${event.attendees.join(', ')}`;
  const vector = await embeddings.embedQuery(contentToEmbed);

  // Store in meetings table using upsert
  const { error } = await supabase.from('meetings').upsert(
    {
      client_name: event.metadata?.client_name || event.summary.split(' - ')[0],
      project_name: event.metadata?.project_name || event.summary.split(' - ')[1] || 'Discussion',
      meeting_date: event.startTime,
      attendees: event.attendees,
      summary: event.description || event.summary,
      meeting_goal: event.metadata?.meeting_goal || event.description || '',
      embedding: vector,
      raw_summary: event.metadata?.raw_summary || null
    },
    {
      onConflict: 'client_name,project_name,meeting_date',
      ignoreDuplicates: false // This will update the existing record
    }
  );

  if (error) {
    console.error('❌ Error upserting event embedding:', error.message);
  } else {
    console.log(`✅ Embedded and stored: ${event.summary}`);
  }
}

// Batch embed all events from the state
export async function embedAndStoreAllEvents(state: GraphState) {
  for (const event of state.calendarEvents) {
    await embedAndStoreEvent(event);
  }
}

// Format search query for Supabase text search
function formatSearchQuery(query: string): string {
  // Clean and normalize the search query
  return query
    .replace(/[^\w\s]/g, ' ')  // Remove special characters
    .split(/\s+/)              // Split into words
    .filter(word => word.length > 0)  // Remove empty strings
    .join(' ');  // Join back with spaces for plain text search
}

// Search for stored documents using vector similarity search
export async function searchDocuments(searchQuery: string, currentMeetingDate?: string) {
  try {
    console.log(`🔍 Searching Supabase for: "${searchQuery}"`);

    // Generate embedding for the search query
    const queryEmbedding = await embeddings.embedQuery(searchQuery);

    // Perform vector similarity search
    const { data: documents, error } = await supabase
      .rpc('match_events', {
        query_embedding: queryEmbedding,
        match_threshold: 0.5, // Adjust this threshold as needed
        match_count: 5, // Return top 5 matches
        exclude_date: currentMeetingDate || new Date().toISOString() // Exclude current meeting
      });

    if (error) {
      console.error('❌ Error searching documents:', error);
      return [];
    }

    // Also perform metadata search in parallel for better results
    const searchTerms = searchQuery.toLowerCase().split(/\s+/).filter(term => term.length > 2);
    const { data: metadataMatches, error: metadataError } = await supabase
      .from('meetings')
      .select('*')
      .or(searchTerms.map(term => 
        `client_name.ilike.%${term}%,project_name.ilike.%${term}%`
      ).join(','))
      .lt('meeting_date', currentMeetingDate || new Date().toISOString()) // Exclude current meeting and future meetings
      .limit(5)
      .then(({ data, error }) => ({
        data: data?.map(m => ({
          id: m.id,
          summary: m.summary,
          description: m.summary,
          start_time: m.meeting_date,
          attendees: m.attendees,
          location: '',
          content: m.summary,
          embedding: m.embedding,
          metadata: {
            client_name: m.client_name,
            project_name: m.project_name,
            meeting_goal: m.meeting_goal,
            startTime: m.meeting_date,
            summary: m.summary
          }
        })),
        error
      }));

    if (metadataError) {
      console.error('❌ Error in metadata search:', metadataError);
    }

    // Combine and deduplicate results
    const allDocuments = [...(documents || []), ...(metadataMatches || [])];
    const seen = new Set<string>();
    const uniqueDocuments = allDocuments.filter(doc => {
      const key = `${doc.summary}-${doc.start_time}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by relevance and recency
    const sortedDocuments = uniqueDocuments.sort((a, b) => {
      // If similarity scores are available, use them
      if ('similarity' in a && 'similarity' in b) {
        return (b as any).similarity - (a as any).similarity;
      }
      // Otherwise sort by date
      return new Date(b.start_time).getTime() - new Date(a.start_time).getTime();
    });

    console.log(`📄 Found ${sortedDocuments.length} matching documents`);
    return sortedDocuments as StoredDocument[];

  } catch (error) {
    console.error('Failed to search documents:', error);
    return [];
  }
}

// Get documents by criteria
export async function getDocuments(clientName?: string, projectName?: string) {
  try {
    let query = supabase
      .from('documents')
      .select('*')
      .order('start_time', { ascending: false });

    if (clientName) {
      query = query.eq('metadata->client_name', clientName);
    }
    if (projectName) {
      query = query.eq('metadata->project_name', projectName);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching documents:', error);
      throw error;
    }

    return data as StoredDocument[];
  } catch (error) {
    console.error('Failed to fetch documents:', error);
    throw error;
  }
}
