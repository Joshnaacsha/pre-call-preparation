export function formatMeetingTime(isoTime: string): string {
  const date = new Date(isoTime);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function getTimeUntilMeeting(isoTime: string): string {
  const meetingTime = new Date(isoTime).getTime();
  const currentTime = Date.now();
  const difference = meetingTime - currentTime;

  const hours = Math.floor(difference / (1000 * 60 * 60));
  const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));

  if (hours < 0 || minutes < 0) {
    return 'Started';
  }

  if (hours === 0) {
    return `In ${minutes}m`;
  }

  return `In ${hours}h ${minutes}m`;
}
