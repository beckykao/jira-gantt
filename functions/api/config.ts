// Public, non-secret config the frontend needs (e.g. to build "open in
// Jira" links). Never exposes JIRA_EMAIL / JIRA_API_TOKEN.

import { errorResponse, json } from '../lib/http';
import { Env } from '../lib/types';

export async function onRequestGet(context: { env: Env }): Promise<Response> {
  try {
    return json({ jiraBaseUrl: context.env.JIRA_BASE_URL || null });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { status: 204 });
}
