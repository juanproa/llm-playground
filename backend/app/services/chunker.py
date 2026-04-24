"""Recursive text chunker for RAG ingestion.

Uses a token-approximation (chars/4) since we don't want to ship a tokenizer
dependency per provider. Recursively splits on paragraphs → sentences → words
so chunks respect natural boundaries when possible. Overlap is applied in
tokens too.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

# Rough approximation — 1 token ~ 4 characters for English-ish text. Good
# enough for chunking; the embedding model re-tokenizes anyway.
CHARS_PER_TOKEN = 4

_PARAGRAPH_SPLIT = re.compile(r"\n\s*\n+")
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


def _approx_tokens(text: str) -> int:
    return max(1, len(text) // CHARS_PER_TOKEN)


@dataclass
class TextChunk:
    content: str
    token_count: int


def chunk_text(
    text: str,
    chunk_size_tokens: int = 800,
    overlap_tokens: int = 100,
) -> list[TextChunk]:
    """Split `text` into overlapping chunks.

    Strategy:
      1. Split into paragraphs (\\n\\n).
      2. Pack paragraphs into chunks until chunk_size is reached.
      3. Paragraphs longer than chunk_size are sub-split on sentences,
         and sentences longer than chunk_size are hard-split on words.
      4. Apply overlap by carrying the trailing overlap_tokens of one chunk
         into the next.
    """
    if not text or not text.strip():
        return []

    max_chars = chunk_size_tokens * CHARS_PER_TOKEN
    overlap_chars = overlap_tokens * CHARS_PER_TOKEN

    # First expand into atomic pieces (paragraphs → sentences → word groups)
    pieces: list[str] = []
    for para in _PARAGRAPH_SPLIT.split(text.strip()):
        para = para.strip()
        if not para:
            continue
        if len(para) <= max_chars:
            pieces.append(para)
            continue
        # Paragraph too big — split on sentences
        for sent in _SENTENCE_SPLIT.split(para):
            sent = sent.strip()
            if not sent:
                continue
            if len(sent) <= max_chars:
                pieces.append(sent)
            else:
                # Sentence still too big — hard split on word chunks
                words = sent.split()
                cur: list[str] = []
                cur_len = 0
                for w in words:
                    if cur_len + len(w) + 1 > max_chars and cur:
                        pieces.append(" ".join(cur))
                        cur = [w]
                        cur_len = len(w)
                    else:
                        cur.append(w)
                        cur_len += len(w) + 1
                if cur:
                    pieces.append(" ".join(cur))

    # Pack pieces into chunks respecting max_chars, with overlap from previous chunk tail
    chunks: list[TextChunk] = []
    buffer = ""
    for piece in pieces:
        sep = "\n\n" if buffer else ""
        candidate = buffer + sep + piece
        if len(candidate) <= max_chars:
            buffer = candidate
        else:
            if buffer:
                chunks.append(TextChunk(content=buffer, token_count=_approx_tokens(buffer)))
                # carry overlap tail
                tail = buffer[-overlap_chars:] if overlap_chars > 0 else ""
                buffer = (tail + "\n\n" + piece) if tail else piece
                # If adding this piece still overflows, flush whole piece(s)
                while len(buffer) > max_chars:
                    chunks.append(TextChunk(content=buffer[:max_chars], token_count=_approx_tokens(buffer[:max_chars])))
                    buffer = buffer[max_chars - overlap_chars:] if overlap_chars > 0 else buffer[max_chars:]
            else:
                # No buffer, but piece is > max_chars — hard-slice
                while len(piece) > max_chars:
                    chunks.append(TextChunk(content=piece[:max_chars], token_count=_approx_tokens(piece[:max_chars])))
                    piece = piece[max_chars - overlap_chars:] if overlap_chars > 0 else piece[max_chars:]
                buffer = piece

    if buffer:
        chunks.append(TextChunk(content=buffer, token_count=_approx_tokens(buffer)))

    return chunks
