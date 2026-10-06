import { whoIs } from '../../../lib/guard';
import { errorResponse, json, options } from '../../../lib/http';
import * as jira from '../../../lib/jira';
import { resolveJiraCreds } from '../../../lib/jiraCreds';
import { AppError, Env } from '../../../lib/types';

export async function onRequestGet(context: {
  env: Env;
  request: Request;
  params: { projectKey: string };
}): Promise<Response> {
  try {
    const projectKey = context.params.projectKey;
    if (!projectKey) throw new AppError('缺少 Jira 專案代碼。', 400, 'missing_project_key');
    const who = await whoIs(context);
    const creds = await resolveJiraCreds(context.env, who.email);
    return json({ versions: await jira.listVersions(creds, projectKey) });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
