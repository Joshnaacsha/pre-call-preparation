import { motion } from 'framer-motion';
import { Calendar, MessageCircle, Zap } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { useAppContext } from '../../contexts/AppContext';

const features = [
  {
    title: 'Automatic Detection',
    description: 'We scan your calendar for client meetings and prepare briefings automatically.'
  },
  {
    title: 'Email Notifications',
    description: 'Get briefing materials 3 hours before every client meeting.'
  },
  {
    title: 'AI Research',
    description: 'Our AI analyzes company background, past interactions, and recent updates.'
  },
  {
    title: 'Privacy First',
    description: 'We only access meeting details and never store sensitive information.'
  }
];

export function LandingPage() {
  const { dispatch } = useAppContext();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-blue-900 dark:to-purple-900">
      <div className="container mx-auto px-6 py-12">
        {/* Hero Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-center mb-16"
        >
          <div className="flex items-center justify-center mb-6">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
              className="p-4 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-2xl"
            >
              <Zap className="h-8 w-8 text-white" />
            </motion.div>
          </div>
          
          <h1 className="text-5xl md:text-7xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent mb-6">
            Pre-Call Preparation
          </h1>
          
          <p className="text-xl md:text-2xl text-gray-600 dark:text-gray-300 mb-12 max-w-3xl mx-auto leading-relaxed">
            Get AI-powered briefings delivered to your inbox before every client meeting.
          </p>

          {/* Action Card */}
          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto mb-16">
            <Card onClick={() => dispatch({ type: 'SET_MODE', payload: 'oauth' })}>
              <div className="p-8 text-center">
                <div className="inline-flex p-4 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg mb-6">
                  <Calendar className="h-8 w-8 text-white" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                  🔗 Subscribe Now
                </h3>
                <p className="text-gray-600 dark:text-gray-300 mb-6">
                  Connect your calendar to receive automatic meeting briefings via email
                </p>
                <Button size="lg" className="w-full">
                  Connect Calendar
                </Button>
              </div>
            </Card>

            <Card onClick={() => dispatch({ type: 'SET_MODE', payload: 'chat' })}>
              <div className="p-8 text-center">
                <div className="inline-flex p-4 rounded-2xl bg-gradient-to-br from-purple-500 to-purple-600 shadow-lg mb-6">
                  <MessageCircle className="h-8 w-8 text-white" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                  💬 Chat with AI
                </h3>
                <p className="text-gray-600 dark:text-gray-300 mb-6">
                  Conversational meeting preparation with intelligent AI assistance
                </p>
                <Button variant="secondary" size="lg" className="w-full">
                  Start Chat
                </Button>
              </div>
            </Card>
          </div>
        </motion.div>

        {/* Features Grid */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 mb-16"
        >
          {features.map((feature, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 * index }}
            >
              <Card className="p-6 text-center h-full">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  {feature.title}
                </h3>
                <p className="text-gray-600 dark:text-gray-300 text-sm">
                  {feature.description}
                </p>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}