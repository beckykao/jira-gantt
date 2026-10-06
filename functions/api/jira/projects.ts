import { whoIs } from '../../lib/guard';
import { errorResponse, json, options } from '../../lib/http';
import * as jira from '../../lib/jira';
import { resolveJiraCreds } from '../../lib/jiraCreds';
import { Env } from '../../lib/types';

export async function onRequestGet(context: { env: Env; request: Request }): Promise<Response> {
  try {
    const who = await whoIs(context);
    const creds = await resolveJiraCreds(context.env, who.email);
    return json({ projects: await jira.listProjects(creds) });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
