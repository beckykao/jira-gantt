// Public: what the login page needs to know before anyone is signed in.

import { accessConfigured } from '../../lib/auth';
import { errorResponse, json, options } from '../../lib/http';
import { normalizeAllowedBaseUrl } from '../../lib/session';
import { Env } from '../../lib/types';

export async function onRequestGet(context: { env: Env }): Promise<Response> {
  try {
    return json({
      method: accessConfigured(context.env) ? 'access' : 'jira',
      jiraBaseUrl: normalizeAllowedBaseUrl(context.env),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
