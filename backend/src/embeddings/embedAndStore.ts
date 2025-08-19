import { OpenAIEmbeddings } from '@langchain/openai';
import { supabase } from '../supabase/client.js';
import { CalendarEvent, GraphState } from '../graph/graphState';

const embeddings = new OpenAIEmbeddings();

export interface StoredDocument {
  summary: string;
  description: string;
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
  };
  raw_summary?: any;
}

export async function embedAndStoreEvent(event: CalendarEvent) {
  const contentToEmbed = `${event.summary}\n${event.description}\n${event.location}\n${event.attendees.join(', ')}`;
  const vector = await embeddings.embedQuery(contentToEmbed);


const { error } = await supabase.from('documents').insert({
  summary: event.summary,
  description: event.description,
  start_time: event.startTime,
  attendees: event.attendees,
  location: event.location,
  content: contentToEmbed,
  embedding: vector,
  metadata: {
    summary: event.summary,
    startTime: event.startTime,
    location: event.location,
  },
});

  if (error) {
    console.error('❌ Error inserting event embedding:', error.message);
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

// Search for stored documents
export async function searchDocuments(searchQuery: string) {
  try {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .textSearch('content', searchQuery)
      .order('start_time', { ascending: false });

    if (error) {
      console.error('Error searching documents:', error);
      throw error;
    }

    return data as StoredDocument[];
  } catch (error) {
    console.error('Failed to search documents:', error);
    throw error;
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
