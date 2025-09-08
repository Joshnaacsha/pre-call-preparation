import React from 'react';
import { motion } from 'framer-motion';
import { Clock, Users, CheckCircle, AlertCircle, FileText, Mail } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Meeting } from '../../types';
import { formatMeetingTime, getTimeUntilMeeting } from '../../utils';

interface MeetingCardProps {
  meeting: Meeting;
}

export function MeetingCard({ meeting }: MeetingCardProps) {
  const urgencyColors = {
    high: 'text-red-600 bg-red-100 dark:bg-red-900/20',
    medium: 'text-orange-600 bg-orange-100 dark:bg-orange-900/20',
    low: 'text-green-600 bg-green-100 dark:bg-green-900/20',
  };

  const statusIcons = {
    pending: <Clock className="h-4 w-4" />,
    processing: <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }}><Clock className="h-4 w-4" /></motion.div>,
    completed: <CheckCircle className="h-4 w-4" />,
    failed: <AlertCircle className="h-4 w-4" />,
  };

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {meeting.title}
            </h3>
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${urgencyColors[meeting.urgency]}`}>
              {meeting.urgency === 'high' ? 'URGENT < 1hr' : meeting.urgency === 'medium' ? 'Soon < 2hr' : 'Ready'}
            </span>
          </div>
          
          <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-300 mb-3">
            <span>{formatMeetingTime(meeting.startTime)}</span>
            <span>•</span>
            <span>{getTimeUntilMeeting(meeting.startTime)}</span>
          </div>
          
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-4">
            <Users className="h-4 w-4" />
            <span>{meeting.attendees.length} attendees</span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {statusIcons[meeting.status]}
          <span className="text-sm font-medium capitalize text-gray-600 dark:text-gray-300">
            {meeting.status}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-1">
            <FileText className="h-4 w-4" />
            <span>{meeting.pdfGenerated ? 'PDF Ready' : 'Generating...'}</span>
          </div>
          <div className="flex items-center gap-1">
            <Mail className="h-4 w-4" />
            <span>{meeting.emailSent ? 'Email Sent' : 'Pending'}</span>
          </div>
        </div>
        
        {meeting.status === 'completed' && (
          <Button size="sm">
            View Details
          </Button>
        )}
      </div>
    </Card>
  );
}