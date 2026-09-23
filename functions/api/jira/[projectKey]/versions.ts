import { errorResponse, json, options } from '../../../lib/http';
import * as jira from '../../../lib/jira';
import { AppError, Env } from '../../../lib/types';

export async function onRequestGet(context: { env: Env; params: { projectKey: string } }): Promise<Response> {
  try {
    const projectKey = context.params.projectKey;
    if (!projectKey) throw new AppError('缺少 Jira 專案代碼。', 400, 'missing_project_key');
    const versions = await jira.listVersions(context.env, projectKey);
    return json({ versions });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
