import express from 'express';
import CalendarWorker from './services/calendar-worker.js';

export const app = express();

// Add event handler for server shutdown
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM signal');
  CalendarWorker.stop();
  process.exit(0);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`🚀 Server is running at http://localhost:${PORT}`);
  
  // Start the calendar polling worker
  await CalendarWorker.start();
});