import { clsx, type ClassValue } from 'clsx';
import { format, formatDistanceToNow, isWithinInterval, subHours } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatMeetingTime(dateString: string) {
  return format(new Date(dateString), 'MMM dd, h:mm a');
}

export function getMeetingUrgency(startTime: string): 'high' | 'medium' | 'low' {
  const meetingDate = new Date(startTime);
  const now = new Date();
  
  if (isWithinInterval(meetingDate, { start: now, end: subHours(now, -1) })) {
    return 'high';
  } else if (isWithinInterval(meetingDate, { start: now, end: subHours(now, -2) })) {
    return 'medium';
  }
  return 'low';
}

export function getTimeUntilMeeting(startTime: string) {
  return formatDistanceToNow(new Date(startTime), { addSuffix: true });
}