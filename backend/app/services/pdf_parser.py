"""PDF parsing pipeline: Docling + Tesseract OCR combined.

Strategy:
  1. Run both Docling (structured) and Tesseract OCR (pixel-level)
  2. Pick whichever extracted more meaningful text
  3. If Docling text contains many image placeholders relative to real
     content, prefer OCR since the PDF is likely scanned/image-heavy
"""

import logging
import re

logger = logging.getLogger(__name__)

MIN_TEXT_LENGTH = 50
IMAGE_PLACEHOLDER = re.compile(r"<!--\s*image\s*-->")


def parse_pdf(file_path: str) -> str:
    """Parse a PDF file, returning extracted text.

    Runs both Docling and OCR, then picks the best result.
    """
    docling_text = _try_docling(file_path)
    ocr_text = _try_ocr(file_path)

    docling_clean = _clean_text(docling_text) if docling_text else ""
    ocr_clean = _clean_text(ocr_text) if ocr_text else ""

    docling_score = _score(docling_text, docling_clean)
    ocr_score = _score(ocr_text, ocr_clean)

    logger.info(
        "PDF parse results for %s — Docling: %d chars (score %d), OCR: %d chars (score %d)",
        file_path, len(docling_clean), docling_score, len(ocr_clean), ocr_score,
    )

    # Pick the best
    if docling_score >= ocr_score and len(docling_clean) >= MIN_TEXT_LENGTH:
        logger.info("Using Docling result")
        return docling_text.strip()  # type: ignore[union-attr]
    if len(ocr_clean) >= MIN_TEXT_LENGTH:
        logger.info("Using OCR result")
        return ocr_text.strip()  # type: ignore[union-attr]
    if docling_text and len(docling_clean) > 0:
        return docling_text.strip()
    if ocr_text and len(ocr_clean) > 0:
        return ocr_text.strip()

    raise ValueError(f"Failed to extract text from {file_path}")


def _clean_text(text: str) -> str:
    """Remove image placeholders and excessive whitespace for scoring."""
    cleaned = IMAGE_PLACEHOLDER.sub("", text)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _score(raw: str | None, cleaned: str) -> int:
    """Score extraction quality. Higher = better.

    Penalizes results that are mostly image placeholders with little text.
    """
    if not raw or not cleaned:
        return 0

    image_count = len(IMAGE_PLACEHOLDER.findall(raw))
    text_len = len(cleaned)

    # Base score is text length
    score = text_len

    # Penalize if many images vs text (likely scanned, Docling missed content)
    if image_count > 0:
        text_per_image = text_len / image_count
        if text_per_image < 100:
            # Very low text per image placeholder — probably missed content
            score = score // 3

    return score


def _try_docling(file_path: str) -> str | None:
    try:
        from docling.document_converter import DocumentConverter

        converter = DocumentConverter()
        result = converter.convert(file_path)
        return result.document.export_to_markdown()
    except ImportError:
        logger.warning("docling not installed, skipping structured extraction")
        return None
    except Exception as e:
        logger.warning("Docling extraction failed: %s", e)
        return None


def _try_ocr(file_path: str) -> str | None:
    try:
        from pdf2image import convert_from_path
        import pytesseract

        images = convert_from_path(file_path)
        pages = []
        for i, image in enumerate(images):
            text = pytesseract.image_to_string(image)
            if text.strip():
                pages.append(text.strip())
        return "\n\n".join(pages) if pages else None
    except ImportError:
        logger.warning("pdf2image or pytesseract not installed, OCR unavailable")
        return None
    except Exception as e:
        logger.warning("OCR extraction failed: %s", e)
        return None
