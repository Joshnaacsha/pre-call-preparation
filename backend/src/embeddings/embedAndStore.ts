import { OpenAIEmbeddings } from '@langchain/openai';
import { supabase } from '../supabase/client.js';
import { CalendarEvent, GraphState } from '../graph/graphState';

const embeddings = new OpenAIEmbeddings();

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
