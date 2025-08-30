import { GoogleGenerativeAI } from '@google/generative-ai';
import { searchDocuments } from '../embeddings/embedAndStore.js';
import { performTavilySearch, processSearchResults, TavilySearchResult } from './tavilySearchAgent.js';
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

export interface RAGResponse {
  answer: string;
  suggestedQuestions: string[];
  sources: {
    summary: string;
    metadata: any;
  }[];
}

export async function generateResponse(query: string): Promise<RAGResponse> {
  // Search for relevant documents
  const documents = await searchDocuments(query);
  
  if (!documents || documents.length === 0) {
    console.log('📚 No documents found in database, attempting web search...');
    return await fallbackToWebSearch(query);
  }

  // Build context from retrieved documents
  const context = documents.map(doc => {
    const date = doc.start_time ? new Date(doc.start_time).toLocaleDateString() : 'Date not specified';
    const content = doc.description || doc.content || '';
    return `
Meeting Summary: ${doc.metadata?.client_name || ''} - ${doc.metadata?.project_name || ''}
Date: ${date}
Type: ${doc.metadata?.meeting_goal || 'Not specified'}
Key Points:
${content}
---`;
  }).join('\n\n');
  
  console.log('📚 Using context from', documents.length, 'documents');

  // Generate response with context
  const prompt = `
You are an AI assistant helping with meeting preparation and follow-up questions.
Your task is to answer questions based on the meeting summaries provided in the context.

Context from previous meetings and summaries:
${context}

Question: "${query}"

Instructions:
1. Answer based ONLY on information present in the context above
2. If the exact information isn't in the context, say so clearly
3. Focus on facts from the meetings, not general knowledge
4. For questions about recent updates, prioritize information from newer meetings
5. Keep answers concise and specific to what was discussed in meetings

Generate your response in this exact format:
ANSWER: (2-3 sentences directly answering the question, based solely on meeting context)
SUGGESTED_QUESTIONS: (3 relevant follow-up questions that could be answered using the available context)

If you can't find relevant information in the context, respond with:
ANSWER: I don't see this specific information in our meeting records. Would you like me to search external sources?
SUGGESTED_QUESTIONS: (3 alternative questions about topics that ARE covered in the context)
`;

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });

  const response = await result.response.text();
  
  // Parse response
  const answerMatch = response.match(/ANSWER:(.*?)(?=SUGGESTED_QUESTIONS:|$)/s);
  const questionsMatch = response.match(/SUGGESTED_QUESTIONS:(.*?)$/s);
  
  const answer = answerMatch ? answerMatch[1].trim() : "Could not generate an answer";
  const questions = questionsMatch 
    ? questionsMatch[1].trim().split('\n').map(q => q.replace(/^[0-9.-]*\s*/, '').trim()).filter(Boolean)
    : ["Search web for more information?", "Ask about a different aspect?", "Get summary for new client?"];

  return {
    answer,
    suggestedQuestions: questions,
    sources: documents.map(doc => ({
      summary: doc.summary,
      metadata: doc.metadata
    }))
  };
}

export async function fallbackToWebSearch(query: string): Promise<RAGResponse> {
  try {
    // Perform Tavily search
    const results = await performTavilySearch(query);
    
    if (!results || results.length === 0) {
      return {
        answer: "I tried searching external sources but couldn't find relevant information. Would you like to try a different search?",
        suggestedQuestions: [
          "Try searching with different keywords?",
          "Focus on a specific aspect?",
          "Look for information in our meeting records instead?"
        ],
        sources: []
      };
    }

    // Process search results
    const processedResults = await processSearchResults(results, query);

    return {
      answer: processedResults.companyNews,
      suggestedQuestions: [
        "Would you like more specific details about this?",
        "Should I search for recent updates?",
        "Would you like information about a different topic?"
      ],
      sources: results.map((result: TavilySearchResult) => ({
        summary: result.title,
        metadata: {
          url: result.url,
          score: result.score
        }
      }))
    };
  } catch (error) {
    console.error('❌ Error performing external search:', error);
    return {
      answer: "Sorry, I encountered an error while trying to search external sources. Would you like to try something else?",
      suggestedQuestions: [
        "Try searching our meeting records instead?",
        "Search with different keywords?",
        "Focus on a different topic?"
      ],
      sources: []
    };
  }
}
