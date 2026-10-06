// Who am I, is this deployment protected, and is my Jira connected?
// Replaces the old /api/config endpoint.

import { accessConfigured } from '../lib/auth';
import { whoIs } from '../lib/guard';
import { errorResponse, json, options } from '../lib/http';
import { jiraStatus } from '../lib/jiraCreds';
import { sessionDays } from '../lib/session';
import { Env } from '../lib/types';

export async function onRequestGet(context: { env: Env; request: Request }): Promise<Response> {
  try {
    const who = await whoIs(context);
    const jira = await jiraStatus(context.env, who.email);
    return json({
      email: who.email,
      name: who.name,
      // Every request now requires a sign-in (Access or Jira token).
      protected: true,
      loginMethod: who.via,
      canLogout: who.via === 'jira' && !accessConfigured(context.env),
      sessionDays: sessionDays(context.env),
      jira: { ...jira, baseUrl: jira.baseUrl },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
