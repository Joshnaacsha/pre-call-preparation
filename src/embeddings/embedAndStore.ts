import { OpenAIEmbeddings } from '@langchain/openai';
import { supabase } from '../supabase/client.js';
import { CalendarEvent, GraphState } from '../graph/graphState';

const embeddings = new OpenAIEmbeddings();

/**
 * Check if an event already exists in the database
 * @param event - Calendar event to check
 * @returns Promise<boolean> - true if event exists, false otherwise
 */
async function eventAlreadyExists(event: CalendarEvent): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('documents')
      .select('id')
      .eq('summary', event.summary)
      .eq('start_time', event.startTime)
      .limit(1);

    if (error) {
      console.error('❌ Error checking event existence:', error.message);
      return false; // If we can't check, assume it doesn't exist and try to insert
    }

    return data && data.length > 0;
  } catch (error) {
    console.error('❌ Error in eventAlreadyExists:', error);
    return false;
  }
}

/**
 * Embed and store a single calendar event (with duplicate prevention)
 * @param event - Calendar event to embed and store
 */
export async function embedAndStoreEvent(event: CalendarEvent) {
  try {
    // Check if event already exists
    const exists = await eventAlreadyExists(event);
    
    if (exists) {
      console.log(`⏭️  Event already exists, skipping: ${event.summary}`);
      return;
    }

    console.log(`🔄 Processing new event: ${event.summary}`);
    
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
    
  } catch (error) {
    console.error(`❌ Error processing event "${event.summary}":`, error);
  }
}

/**
 * Batch embed all events from the state (with duplicate prevention)
 * @param state - Graph state containing calendar events
 */
export async function embedAndStoreAllEvents(state: GraphState) {
  if (!state.calendarEvents || state.calendarEvents.length === 0) {
    console.log('📭 No calendar events to process');
    return;
  }

  console.log(`🔄 Processing ${state.calendarEvents.length} calendar event(s)...`);
  
  let processed = 0;
  let skipped = 0;
  
  for (const event of state.calendarEvents) {
    const exists = await eventAlreadyExists(event);
    
    if (exists) {
      console.log(`⏭️  Event already exists, skipping: ${event.summary}`);
      skipped++;
    } else {
      await embedAndStoreEvent(event);
      processed++;
    }
  }
  
  console.log(`📊 Embedding Summary: ${processed} new, ${skipped} skipped, ${state.calendarEvents.length} total`);
}