import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Send, MessageCircle, Sparkles } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { ChatMessage } from './ChatMessage';
import { useAppContext } from '../../contexts/AppContext';
import { apiService } from '../../services/api';

const suggestions = [
  "Prepare for my Ford meeting tomorrow at 2pm",
  "I have a client call with Acme Corp next week",
  "Research attendees for my board meeting",
  "Generate brief for quarterly review"
];

export function ChatInterface() {
  const { state, dispatch } = useAppContext();
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.chatMessages]);

  const handleSend = async () => {
    if (!message.trim() || isSending) return;

    const userMessage = {
      id: Date.now().toString(),
      role: 'user' as const,
      content: message.trim(),
      timestamp: new Date().toISOString(),
    };

    dispatch({ type: 'ADD_MESSAGE', payload: userMessage });
    setMessage('');
    setIsSending(true);

    try {
      const result = await apiService.sendChatMessage(userMessage.content);
      console.log('Chat response:', result);

      const messageContent = result.needsMoreInfo ? result.followUpQuestion : result.reply;
      if (messageContent) {
        const aiMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant' as const,
          content: messageContent,
          timestamp: new Date().toISOString(),
        };
        dispatch({ type: 'ADD_MESSAGE', payload: aiMessage });
      }
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to send message';
      const aiMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant' as const,
        content: `Error: ${errorMessage}`,
        timestamp: new Date().toISOString(),
      };
      dispatch({ type: 'ADD_MESSAGE', payload: aiMessage });
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setMessage(suggestion);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-blue-900 dark:to-purple-900 flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-200/20 dark:border-gray-700/20 backdrop-blur-xl bg-white/80 dark:bg-gray-800/80 p-6">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => dispatch({ type: 'SET_MODE', payload: 'landing' })}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 shadow-lg">
                <MessageCircle className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                  AI Meeting Assistant
                </h1>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Conversational meeting preparation
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-hidden">
        <div className="max-w-4xl mx-auto p-6 h-full flex flex-col">
          <div className="flex-1 overflow-y-auto space-y-6 mb-6">
            {state.chatMessages.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center py-12"
              >
                <div className="inline-flex p-6 rounded-3xl bg-gradient-to-br from-purple-100 to-blue-100 dark:from-purple-900/20 dark:to-blue-900/20 mb-6">
                  <Sparkles className="h-12 w-12 text-purple-600 dark:text-purple-400" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                  How can I help you prepare?
                </h2>
                <p className="text-gray-600 dark:text-gray-300 mb-8">
                  Tell me about your upcoming meeting and I'll prepare comprehensive research materials.
                </p>
                
                <div className="grid gap-3 max-w-2xl mx-auto">
                  {suggestions.map((suggestion, index) => (
                    <motion.button
                      key={index}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.1 }}
                      onClick={() => handleSuggestionClick(suggestion)}
                      className="text-left p-4 rounded-xl bg-white/60 dark:bg-gray-800/60 backdrop-blur border border-gray-200/20 dark:border-gray-700/20 hover:bg-white/80 dark:hover:bg-gray-800/80 transition-all duration-200 text-gray-700 dark:text-gray-300"
                    >
                      "{suggestion}"
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            ) : (
              <AnimatePresence>
                {state.chatMessages.map((msg) => (
                  <ChatMessage key={msg.id} message={msg} />
                ))}
                {isSending && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex items-center gap-2 text-gray-500 dark:text-gray-400"
                  >
                    <div className="flex gap-1">
                      <motion.div className="w-2 h-2 bg-purple-500 rounded-full" animate={{ y: [-2, 2, -2] }} transition={{ duration: 1, repeat: Infinity, delay: 0 }} />
                      <motion.div className="w-2 h-2 bg-purple-500 rounded-full" animate={{ y: [-2, 2, -2] }} transition={{ duration: 1, repeat: Infinity, delay: 0.2 }} />
                      <motion.div className="w-2 h-2 bg-purple-500 rounded-full" animate={{ y: [-2, 2, -2] }} transition={{ duration: 1, repeat: Infinity, delay: 0.4 }} />
                    </div>
                    <span>AI is thinking...</span>
                  </motion.div>
                )}
              </AnimatePresence>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <Card className="p-4">
            <div className="flex gap-4">
              <div className="flex-1">
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Describe your meeting or ask a question..."
                  className="w-full p-3 bg-transparent border-0 resize-none focus:outline-none text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                  rows={1}
                  style={{ minHeight: '44px', maxHeight: '120px' }}
                />
              </div>
              <Button
                onClick={handleSend}
                disabled={!message.trim() || isSending}
                className="px-4"
              >
                {isSending ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    className="w-4 h-4"
                  >
                    Loading...
                  </motion.div>
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}