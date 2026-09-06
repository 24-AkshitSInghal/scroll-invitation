import { neon } from '@neondatabase/serverless';

let sqlClient;
let schemaReady;

function database() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not configured');
  if (!sqlClient) sqlClient = neon(connectionString);
  return sqlClient;
}

async function ensureSchema(sql) {
  if (!schemaReady) {
    schemaReady = sql`
      CREATE TABLE IF NOT EXISTS rsvps (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
        attending BOOLEAN NOT NULL,
        message TEXT NOT NULL DEFAULT '',
        client_submitted_at TIMESTAMPTZ,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
  }

  try {
    await schemaReady;
  } catch (error) {
    // Allow a later invocation to retry after a temporary database failure.
    schemaReady = null;
    throw error;
  }
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = request.body && typeof request.body === 'object' ? request.body : {};

    // Hidden-field honeypot: real guests leave it empty, simple form bots do not.
    if (body.website) return response.status(201).json({ ok: true });

    const name = String(body.name || '').trim();
    const attending = body.attending;
    const message = String(body.message || '').trim();

    if (!name || name.length > 120 || !['yes', 'no'].includes(attending) || message.length > 1000) {
      return response.status(400).json({ error: 'Invalid RSVP information' });
    }

    const clientSubmittedAt = body.submittedAt && !Number.isNaN(Date.parse(body.submittedAt))
      ? body.submittedAt
      : null;

    const sql = database();
    await ensureSchema(sql);
    await sql`
      INSERT INTO rsvps (name, attending, message, client_submitted_at)
      VALUES (${name}, ${attending === 'yes'}, ${message}, ${clientSubmittedAt}::timestamptz)
    `;

    return response.status(201).json({ ok: true });
  } catch (error) {
    console.error('RSVP submission failed:', error);
    return response.status(500).json({ error: 'Unable to save RSVP' });
  }
}
