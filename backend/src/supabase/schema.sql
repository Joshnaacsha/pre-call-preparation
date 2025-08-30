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
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_meetings_updated_at') THEN
        CREATE TRIGGER update_meetings_updated_at
            BEFORE UPDATE ON meetings
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- Enable full-text search capabilities
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(client_name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(project_name, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(summary, '')), 'C')
    ) STORED;

CREATE INDEX IF NOT EXISTS meetings_search_idx ON meetings USING GIN (search_vector);

-- Add a column for the embedding vector
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Create an index for similarity search
CREATE INDEX IF NOT EXISTS meetings_embedding_idx ON meetings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS match_events(vector(1536), float, int);
DROP FUNCTION IF EXISTS match_events(vector(1536), float, int, timestamptz);

-- Function to perform similarity search
CREATE OR REPLACE FUNCTION match_events(
    query_embedding vector(1536),
    match_threshold float,
    match_count int,
    exclude_date timestamptz DEFAULT NULL
)
RETURNS TABLE (
    id integer,  -- Changed from bigint to integer to match SERIAL type
    summary text,
    description text,
    start_time timestamptz,
    attendees text[],
    location text,
    content text,
    embedding vector(1536),
    metadata jsonb,
    similarity float
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
BEGIN
    RETURN QUERY
    SELECT 
        m.id::integer,  -- Explicit cast to integer
        m.summary,
        m.summary as description,
        m.meeting_date as start_time,
        m.attendees,
        '' as location,
        m.summary as content,
        m.embedding,
        jsonb_build_object(
            'client_name', m.client_name,
            'project_name', m.project_name,
            'meeting_goal', m.meeting_goal,
            'startTime', m.meeting_date::text,  -- Convert timestamp to text for JSON
            'summary', m.summary
        ) as metadata,
        (1 - (m.embedding <=> query_embedding))::float as similarity  -- Explicit cast to float
    FROM meetings m
    WHERE m.embedding IS NOT NULL  -- Only search records with embeddings
      AND 1 - (m.embedding <=> query_embedding) > match_threshold
      AND (exclude_date IS NULL OR m.meeting_date < exclude_date)  -- Exclude current meeting and future meetings
    ORDER BY similarity DESC
    LIMIT match_count;
END;
$$;
