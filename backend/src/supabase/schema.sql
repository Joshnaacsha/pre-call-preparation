-- Create meetings table with summaries
CREATE TABLE IF NOT EXISTS meetings (
    id SERIAL PRIMARY KEY,
    client_name TEXT NOT NULL,
    project_name TEXT NOT NULL,
    meeting_date TIMESTAMP WITH TIME ZONE NOT NULL,
    attendees TEXT[] NOT NULL,
    summary TEXT,
    meeting_goal TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    pdf_url TEXT,
    raw_summary JSONB,
    -- Enable full-text search
    UNIQUE (client_name, project_name, meeting_date)
);

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create a trigger to automatically update the updated_at column
CREATE TRIGGER update_meetings_updated_at
    BEFORE UPDATE ON meetings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable full-text search capabilities
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(client_name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(project_name, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(summary, '')), 'C')
    ) STORED;

CREATE INDEX IF NOT EXISTS meetings_search_idx ON meetings USING GIN (search_vector);
