import { OpenAIEmbeddings } from '@langchain/openai';
import { supabase } from '../supabase/client.js';
import { fileURLToPath } from 'url';

const embeddings = new OpenAIEmbeddings();

async function generateEmbeddings() {
  try {
    // Get all meetings without embeddings
    const { data: meetings, error } = await supabase
      .from('meetings')
      .select('*')
      .is('embedding', null);

    if (error) {
      throw error;
    }

    console.log(`🔍 Found ${meetings?.length || 0} meetings without embeddings`);

    // Process each meeting
    for (const meeting of meetings || []) {
      const contentToEmbed = `${meeting.client_name}\n${meeting.project_name}\n${meeting.summary || ''}\n${meeting.meeting_goal || ''}\n${meeting.attendees.join(', ')}`;
      
      try {
        const vector = await embeddings.embedQuery(contentToEmbed);
        
        const { error: updateError } = await supabase
          .from('meetings')
          .update({ embedding: vector })
          .eq('id', meeting.id);

        if (updateError) {
          console.error(`❌ Error updating meeting ${meeting.id}:`, updateError);
        } else {
          console.log(`✅ Added embedding for meeting: ${meeting.client_name} - ${meeting.project_name}`);
        }
      } catch (err) {
        console.error(`❌ Error generating embedding for meeting ${meeting.id}:`, err);
      }
    }

    console.log('✅ Embedding migration completed');
  } catch (error) {
    console.error('❌ Error in embedding migration:', error);
  }
}

// If this file is run directly (not imported)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateEmbeddings().then(() => {
    console.log('Migration complete');
    process.exit(0);
  }).catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
}
