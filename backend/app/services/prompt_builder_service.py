import json
import logging
import re
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.inference import InferenceRun
from app.models.model_config import ModelConfig
from app.models.prompt import PromptVersion
from app.providers.registry import get_provider
from app.services.model_config_service import decrypt_api_key

logger = logging.getLogger(__name__)


def _extract_json_fields(response_text: str) -> dict | None:
    """Extract JSON fields from response using regex, tolerant of malformed JSON."""
    result = {}

    # Extract "reasoning" field - look for "reasoning": "..." or "reasoning":"..."
    reasoning_match = re.search(
        r'"reasoning"\s*:\s*"([^"]*(?:\\.[^"]*)*)"',
        response_text,
        re.DOTALL
    )
    if reasoning_match:
        result["reasoning"] = reasoning_match.group(1).replace('\\"', '"')
    else:
        # Fallback: extract everything between "reasoning": and the next comma/}
        reasoning_match = re.search(
            r'"reasoning"\s*:\s*"((?:[^"\\]|\\.)*)"',
            response_text,
            re.DOTALL
        )
        if reasoning_match:
            result["reasoning"] = reasoning_match.group(1).replace('\\"', '"')

    # Extract "suggestion" field - should be one of: improve_prompt, no_change, error
    suggestion_match = re.search(
        r'"suggestion"\s*:\s*"(improve_prompt|no_change|error)"',
        response_text
    )
    if suggestion_match:
        result["suggestion"] = suggestion_match.group(1)

    # Extract "proposed_prompt" field
    prompt_match = re.search(
        r'"proposed_prompt"\s*:\s*"((?:[^"\\]|\\.)*)"',
        response_text,
        re.DOTALL
    )
    if prompt_match:
        result["proposed_prompt"] = prompt_match.group(1).replace('\\"', '"')

    # Extract "explanation" field
    explanation_match = re.search(
        r'"explanation"\s*:\s*"((?:[^"\\]|\\.)*)"',
        response_text,
        re.DOTALL
    )
    if explanation_match:
        result["explanation"] = explanation_match.group(1).replace('\\"', '"')

    # Check if we got the required fields
    if "reasoning" not in result or "suggestion" not in result:
        return None

    return result


async def ask_helper_llm(
    db: AsyncSession,
    project_id: str,
    run_id: str,
    user_question: str,
    helper_model_config_id: str | None = None,
) -> dict:
    """
    Analyze the inference run and suggest prompt improvements.

    Returns:
        {
            "reasoning": "Why the output is suboptimal",
            "suggestion": "improve_prompt" | "no_change" | "error",
            "proposed_prompt": "new prompt text (if suggestion='improve_prompt')",
            "explanation": "Human explanation of change"
        }
    """

    # Fetch the run and its context
    run = await db.get(InferenceRun, run_id)
    if not run:
        return {
            "reasoning": "Run not found",
            "suggestion": "error",
            "error_message": f"Run {run_id} not found",
        }

    prompt_version = await db.get(PromptVersion, run.prompt_version_id)
    if not prompt_version:
        return {
            "reasoning": "Prompt version not found",
            "suggestion": "error",
            "error_message": f"Prompt version {run.prompt_version_id} not found",
        }

    # Build context for the helper LLM
    context = f"""You are a prompt optimization assistant. Analyze this inference run and suggest improvements.

**Original Prompt**:
{prompt_version.content}

**System Message**:
{prompt_version.system_message or "(none)"}

**Input**:
{run.input_text or "(empty)"}

**Actual Output**:
{run.output_text or "(no output)"}

**User's Question/Concern**:
{user_question}

Your task: Explain why the output may be suboptimal and suggest a revised prompt if needed.

CRITICAL: You MUST respond with ONLY valid JSON. No markdown. No code blocks. No explanation.
Just the JSON object, nothing else:
{{"reasoning": "Why...", "suggestion": "improve_prompt" or "no_change", "proposed_prompt": "new prompt (only if suggestion=improve_prompt)", "explanation": "What changed (only if suggestion=improve_prompt)"}}"""

    # Determine which model to use for the helper
    if helper_model_config_id:
        helper_model = await db.get(ModelConfig, helper_model_config_id)
        if not helper_model:
            return {
                "reasoning": "Helper model not found",
                "suggestion": "error",
                "error_message": f"Helper model {helper_model_config_id} not found",
            }
    else:
        # Default to Claude if no model specified
        from sqlalchemy import select

        # Try to find a Claude model (preferred for reasoning)
        result = await db.execute(
            select(ModelConfig)
            .where(ModelConfig.model_id.contains("claude"))
            .where(ModelConfig.is_enabled == True)
            .limit(1)
        )
        helper_model = result.scalar_one_or_none()

        if not helper_model:
            # If no Claude model found, use any enabled model
            result = await db.execute(
                select(ModelConfig)
                .where(ModelConfig.is_enabled == True)
                .limit(1)
            )
            helper_model = result.scalar_one_or_none()

        if not helper_model:
            return {
                "reasoning": "No model available",
                "suggestion": "error",
                "error_message": "No enabled model configuration found for helper LLM. Please configure at least one model.",
            }

    # Get the LLM provider and make the request
    try:
        api_key = (
            decrypt_api_key(helper_model.api_key_encrypted)
            if helper_model.api_key_encrypted
            else None
        )
        provider = get_provider(
            helper_model.provider,
            api_key=api_key,
            base_url=helper_model.base_url,
        )

        messages = [
            {
                "role": "system",
                "content": "You are a JSON-only assistant. Respond ONLY with raw JSON objects. Never use markdown code blocks. Never add explanations. Just the JSON.",
            },
            {"role": "user", "content": context},
        ]

        response = await provider.generate(
            messages=messages,
            model_id=helper_model.model_id,
            max_tokens=2048,
            temperature=0.7,
        )

        # Parse JSON response - be tolerant of various formats
        response_text = response.content.strip()

        logger.info(f"Helper LLM raw response (first 1000 chars): {response_text[:1000]}")

        # Try to extract JSON if it's wrapped in markdown
        if "```" in response_text:
            parts = response_text.split("```")
            if len(parts) >= 2:
                response_text = parts[1]
                if response_text.startswith("json"):
                    response_text = response_text[4:].strip()

        # Use regex-based extraction instead of JSON parsing for robustness
        parsed = _extract_json_fields(response_text)
        if not parsed:
            raise json.JSONDecodeError("Could not extract fields from response", response_text, 0)

        return {
            "reasoning": parsed.get("reasoning", ""),
            "suggestion": parsed.get("suggestion", "error"),
            "proposed_prompt": parsed.get("proposed_prompt"),
            "explanation": parsed.get("explanation", ""),
        }

    except json.JSONDecodeError as e:
        # Show a snippet of what the LLM returned to help debug
        snippet = response.content[:800] if len(response.content) > 800 else response.content
        logger.error(f"Failed to parse JSON response from helper LLM: {e}\nResponse snippet: {snippet}")
        return {
            "reasoning": "Failed to parse response",
            "suggestion": "error",
            "error_message": f"Helper LLM response could not be parsed as JSON. Try a different model (Claude works best). Check server logs for details. Error: {str(e)[:100]}",
        }
    except Exception as e:
        logger.error(f"Error calling helper LLM: {e}")
        return {
            "reasoning": "Error calling helper LLM",
            "suggestion": "error",
            "error_message": str(e),
        }
