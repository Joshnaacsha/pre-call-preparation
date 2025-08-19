import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Calendar, Plus, Filter } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { MeetingCard } from './MeetingCard';
import { useAppContext } from '../../contexts/AppContext';
import { Meeting } from '../../types';

// Mock data for demo
const mockMeetings: Meeting[] = [
  {
    id: '1',
    title: 'Q4 Strategy Review',
    startTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 mins from now
    endTime: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
    attendees: ['john@company.com', 'sarah@company.com', 'mike@company.com'],
    status: 'processing',
    urgency: 'high',
    pdfGenerated: false,
    emailSent: false,
  },
  {
    id: '2',
    title: 'Client Presentation - Ford',
    startTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours from now
    endTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    attendees: ['contact@ford.com', 'manager@ford.com'],
    status: 'completed',
    urgency: 'medium',
    pdfGenerated: true,
    emailSent: true,
  },
  {
    id: '3',
    title: 'Weekly Team Sync',
    startTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // tomorrow
    endTime: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
    attendees: ['team@company.com'],
    status: 'pending',
    urgency: 'low',
    pdfGenerated: false,
    emailSent: false,
  }
];

export function MeetingDashboard() {
  const { state, dispatch } = useAppContext();

  useEffect(() => {
    // Load mock meetings for demo
    dispatch({ type: 'SET_MEETINGS', payload: mockMeetings });
  }, [dispatch]);

  const pendingMeetings = state.meetings.filter(m => m.status !== 'completed');
  const completedMeetings = state.meetings.filter(m => m.status === 'completed');

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-blue-900 dark:to-purple-900">
      <div className="container mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => dispatch({ type: 'SET_MODE', payload: 'landing' })}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Home
            </Button>
            
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg">
                <Calendar className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  Meeting Dashboard
                </h1>
                <p className="text-gray-600 dark:text-gray-300">
                  Track your meeting preparation progress
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="secondary" size="sm">
              <Filter className="h-4 w-4 mr-2" />
              Filter
            </Button>
            <Button size="sm" onClick={() => dispatch({ type: 'SET_MODE', payload: 'chat' })}>
              <Plus className="h-4 w-4 mr-2" />
              New Meeting
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8"
        >
          <Card className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/20">
                <Calendar className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {pendingMeetings.filter(m => m.urgency === 'high').length}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-300">Urgent</p>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/20">
                <Calendar className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {state.meetings.filter(m => m.status === 'processing').length}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-300">Processing</p>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/20">
                <Calendar className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {completedMeetings.length}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-300">Completed</p>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/20">
                <Calendar className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {state.meetings.length}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-300">Total</p>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Meetings Lists */}
        <div className="grid lg:grid-cols-2 gap-8">
          {/* Pending Meetings */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
          >
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Pending Preparation ({pendingMeetings.length})
            </h2>
            <div className="space-y-4">
              {pendingMeetings.length === 0 ? (
                <Card className="p-8 text-center">
                  <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500 dark:text-gray-400">
                    No pending meetings
                  </p>
                </Card>
              ) : (
                pendingMeetings.map(meeting => (
                  <MeetingCard key={meeting.id} meeting={meeting} />
                ))
              )}
            </div>
          </motion.div>

          {/* Completed Meetings */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Recently Completed ({completedMeetings.length})
            </h2>
            <div className="space-y-4">
              {completedMeetings.length === 0 ? (
                <Card className="p-8 text-center">
                  <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500 dark:text-gray-400">
                    No completed meetings yet
                  </p>
                </Card>
              ) : (
                completedMeetings.map(meeting => (
                  <MeetingCard key={meeting.id} meeting={meeting} />
                ))
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}