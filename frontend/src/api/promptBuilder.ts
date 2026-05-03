import { apiFetch } from './client';

export interface PromptBuilderRequest {
  run_id: string;
  user_question: string;
  helper_model_config_id?: string;
}

export interface PromptBuilderResponse {
  reasoning: string;
  suggestion: 'improve_prompt' | 'no_change' | 'error';
  proposed_prompt?: string;
  explanation?: string;
  error_message?: string;
}

export interface ApproveChangeRequest {
  run_id: string;
  proposed_prompt: string;
  explanation: string;
}

export interface ApproveChangeResponse {
  version_id: string;
  version_number: number;
  new_run_id: string;
  new_run_output?: string;
  error_message?: string;
}

export const promptBuilderApi = {
  askHelper: (projectId: string, request: PromptBuilderRequest) =>
    apiFetch<PromptBuilderResponse>(
      `/projects/${projectId}/prompt-builder/ask`,
      { method: 'POST', body: JSON.stringify(request) }
    ),

  approveChange: (projectId: string, request: ApproveChangeRequest) =>
    apiFetch<ApproveChangeResponse>(
      `/projects/${projectId}/prompt-builder/approve-change`,
      { method: 'POST', body: JSON.stringify(request) }
    ),
};
