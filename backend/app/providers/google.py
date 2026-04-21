import logging
from collections.abc import AsyncIterator

from app.providers.base import LLMResponse

logger = logging.getLogger(__name__)

# gemini-2.5-flash is a hybrid thinking model: internal reasoning tokens count
# toward max_output_tokens.  With the default model config of 4 096 tokens the
# model exhausts the budget on reasoning and returns a truncated answer.
# We enforce a floor of 16 384 output tokens for every Google request so
# there is always ample room for the real answer.
_MIN_OUTPUT_TOKENS = 16_384

# Cap the thinking budget at this many tokens.  The remainder of the token
# budget is available for the visible answer.
# Setting to 0 would disable thinking entirely; None lets the model decide
# (risky if max_output_tokens is small).
_THINKING_BUDGET = 8_192


def _effective_max_tokens(requested: int) -> int:
    """Return the token budget to send to the API.

    Never goes below _MIN_OUTPUT_TOKENS, so thinking models always have
    enough room to produce a complete answer.
    """
    return max(requested, _MIN_OUTPUT_TOKENS)


class GoogleProvider:
    def __init__(self, api_key: str | None = None, base_url: str | None = None):
        from google import genai

        self.client = genai.Client(api_key=api_key)

    def _build_config(
        self,
        max_tokens: int,
        temperature: float,
        system_instruction: str | None,
    ):
        from google.genai import types

        effective = _effective_max_tokens(max_tokens)

        # ThinkingConfig limits the reasoning budget so the model cannot
        # exhaust the entire token allocation on internal thoughts.
        thinking_cfg = None
        try:
            thinking_cfg = types.ThinkingConfig(thinkingBudget=_THINKING_BUDGET)
        except Exception:
            pass  # older SDK version without ThinkingConfig — skip

        return types.GenerateContentConfig(
            max_output_tokens=effective,
            temperature=temperature,
            system_instruction=system_instruction,
            thinking_config=thinking_cfg,
        )

    async def generate(
        self,
        messages: list[dict],
        model_id: str,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        **kwargs,
    ) -> LLMResponse:
        system_instruction, contents = self._convert_messages(messages)
        config = self._build_config(max_tokens, temperature, system_instruction)

        response = await self.client.aio.models.generate_content(
            model=model_id,
            contents=contents,
            config=config,
        )

        text = self._extract_text(response)
        input_tokens = (
            response.usage_metadata.prompt_token_count
            if response.usage_metadata else 0
        )
        output_tokens = (
            response.usage_metadata.candidates_token_count
            if response.usage_metadata else 0
        )
        logger.debug(
            "Gemini generate: model=%s input_tokens=%s output_tokens=%s "
            "text_len=%d",
            model_id, input_tokens, output_tokens, len(text),
        )
        return LLMResponse(
            content=text,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            model=model_id,
        )

    async def stream(
        self,
        messages: list[dict],
        model_id: str,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        **kwargs,
    ) -> AsyncIterator[str]:
        system_instruction, contents = self._convert_messages(messages)
        config = self._build_config(max_tokens, temperature, system_instruction)

        response_stream = await self.client.aio.models.generate_content_stream(
            model=model_id,
            contents=contents,
            config=config,
        )
        chunk_count = 0
        total_chars = 0
        async for chunk in response_stream:
            chunk_count += 1
            # chunk.text already skips thought=True parts (SDK handles it)
            try:
                text = chunk.text or ""
            except Exception:
                text = ""

            if not text:
                # Log empty chunks so we can diagnose unexpected stops
                finish = None
                try:
                    finish = chunk.candidates[0].finish_reason if chunk.candidates else None
                except Exception:
                    pass
                if finish:
                    logger.warning(
                        "Gemini chunk #%d empty: finish_reason=%s",
                        chunk_count, finish,
                    )
                continue

            total_chars += len(text)
            yield text

        logger.warning(
            "Gemini stream done: model=%s chunks=%d total_chars=%d "
            "effective_max_tokens=%d",
            model_id, chunk_count, total_chars, _effective_max_tokens(max_tokens),
        )

    # ------------------------------------------------------------------ #
    #  Helpers                                                              #
    # ------------------------------------------------------------------ #

    def _extract_text(self, response) -> str:
        """Safely extract answer text (SDK skips thought=True parts automatically)."""
        try:
            return response.text or ""
        except Exception:
            return ""

    def _convert_messages(self, messages: list[dict]) -> tuple[str | None, list[dict]]:
        """Split messages into (system_instruction, contents).

        System messages are extracted and passed via system_instruction — not
        as user turns — because the Gemini API requires strictly alternating
        user/model turns and has a dedicated field for system prompts.
        """
        system_parts: list[str] = []
        contents: list[dict] = []

        for msg in messages:
            role = msg["role"]
            content = msg["content"]

            if role == "system":
                system_parts.append(content)
                continue

            gemini_role = "user" if role == "user" else "model"

            # Avoid consecutive same-role turns (merge into previous if needed)
            if contents and contents[-1]["role"] == gemini_role:
                contents[-1]["parts"].append({"text": content})
            else:
                contents.append({"role": gemini_role, "parts": [{"text": content}]})

        system_instruction = "\n\n".join(system_parts) if system_parts else None
        return system_instruction, contents
