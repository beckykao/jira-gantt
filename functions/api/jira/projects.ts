import { errorResponse, json, options } from '../../lib/http';
import * as jira from '../../lib/jira';
import { Env } from '../../lib/types';

export async function onRequestGet(context: { env: Env }): Promise<Response> {
  try {
    const projects = await jira.listProjects(context.env);
    return json({ projects });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
