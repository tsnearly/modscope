import { Hono } from 'hono';

export const forms = new Hono();

// Forms would be defined here if any ModScope actions used standard Reddit forms
// e.g. forms.post('/create-report', async (c) => { ... });
