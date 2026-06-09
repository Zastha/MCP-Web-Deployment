"""
pdf_vision_mcp - MCP server que convierte páginas de PDF a imágenes base64
para que Claude pueda analizar gráficas y contenido visual.
"""

import base64
import io
import json
import tempfile
import os
from typing import Optional
from pathlib import Path

import httpx
from pdf2image import convert_from_path, convert_from_bytes
from PIL import Image
from pydantic import BaseModel, Field, ConfigDict, field_validator
from mcp.server.fastmcp import FastMCP

# ─────────────────────────────────────────
# Constantes
# ─────────────────────────────────────────
LOW_QUALITY_DEFAULT_DPI = 96
HIGH_QUALITY_DEFAULT_DPI = 250
DEFAULT_DPI = LOW_QUALITY_DEFAULT_DPI
MAX_DPI = 400
MIN_DPI = 72
MAX_PAGES_BATCH = 10
DEFAULT_IMAGE_FORMAT = "PNG"
LOW_QUALITY_FORMAT = "JPEG"
LOW_QUALITY_JPEG_QUALITY = 45
HIGH_QUALITY_FORMAT = "PNG"
REQUEST_TIMEOUT = 60.0
MAX_IMAGE_PIXELS = 7_000_000
MAX_IMAGE_BASE64_LENGTH = 4_000_000
DPI_REDUCTION_FACTOR = 0.75

# ─────────────────────────────────────────
# Inicialización del servidor
# ─────────────────────────────────────────
mcp = FastMCP("pdf_vision_mcp")


# ─────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────
def _image_to_base64(
    image: Image.Image,
    fmt: str = DEFAULT_IMAGE_FORMAT,
    jpeg_quality: Optional[int] = None,
) -> str:
    """Convierte una imagen PIL a string base64."""
    buffer = io.BytesIO()
    save_kwargs = {"format": fmt}

    if fmt.upper() in {"JPG", "JPEG"}:
        image = image.convert("RGB")
        if jpeg_quality is not None:
            save_kwargs["quality"] = jpeg_quality
            save_kwargs["optimize"] = True

    image.save(buffer, **save_kwargs)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def _crop_image_by_ratio(
    image: Image.Image,
    x_ratio: float,
    y_ratio: float,
    width_ratio: float,
    height_ratio: float,
) -> Image.Image:
    """Recorta una ROI usando coordenadas relativas [0, 1] sobre la página."""
    left = int(image.width * x_ratio)
    top = int(image.height * y_ratio)
    right = int(image.width * (x_ratio + width_ratio))
    bottom = int(image.height * (y_ratio + height_ratio))

    left = max(0, min(left, image.width - 1))
    top = max(0, min(top, image.height - 1))
    right = max(left + 1, min(right, image.width))
    bottom = max(top + 1, min(bottom, image.height))

    return image.crop((left, top, right, bottom))


def _is_image_too_large(image: Image.Image, b64: str) -> bool:
    """Determina si la imagen excede límites de tamaño razonables para respuesta MCP."""
    return (image.width * image.height) > MAX_IMAGE_PIXELS or len(b64) > MAX_IMAGE_BASE64_LENGTH


def _next_lower_dpi(current_dpi: int) -> int:
    """Calcula el próximo DPI a intentar, manteniendo un mínimo seguro."""
    reduced = int(current_dpi * DPI_REDUCTION_FACTOR)
    if reduced >= current_dpi:
        reduced = current_dpi - 10
    return max(MIN_DPI, reduced)


def _render_single_page_with_fallback(
    pdf_bytes: bytes,
    page: int,
    initial_dpi: int,
) -> tuple[Optional[Image.Image], Optional[str], int, bool]:
    """Renderiza una página y reduce DPI automáticamente si la imagen queda demasiado grande."""
    dpi = initial_dpi

    while True:
        images = convert_from_bytes(
            pdf_bytes,
            dpi=dpi,
            first_page=page,
            last_page=page,
        )

        if not images:
            return None, None, dpi, False

        image = images[0]
        b64 = _image_to_base64(image)
        if not _is_image_too_large(image, b64):
            return image, b64, dpi, dpi != initial_dpi

        if dpi <= MIN_DPI:
            # Si no podemos reducir más, devolvemos la mejor opción posible.
            return image, b64, dpi, dpi != initial_dpi

        next_dpi = _next_lower_dpi(dpi)
        if next_dpi == dpi:
            return image, b64, dpi, dpi != initial_dpi
        dpi = next_dpi


def _render_pages_range_with_fallback(
    pdf_bytes: bytes,
    first_page: int,
    last_page: int,
    initial_dpi: int,
) -> tuple[list[dict], int, bool]:
    """Renderiza un rango y reduce DPI automáticamente si alguna imagen queda demasiado grande."""
    dpi = initial_dpi

    while True:
        images = convert_from_bytes(
            pdf_bytes,
            dpi=dpi,
            first_page=first_page,
            last_page=last_page,
        )

        if not images:
            return [], dpi, False

        pages_data: list[dict] = []
        too_large_found = False

        for i, image in enumerate(images):
            b64 = _image_to_base64(image)
            if _is_image_too_large(image, b64):
                too_large_found = True

            pages_data.append({
                "page": first_page + i,
                "width": image.width,
                "height": image.height,
                "image_base64": b64,
            })

        if not too_large_found:
            return pages_data, dpi, dpi != initial_dpi

        if dpi <= MIN_DPI:
            return pages_data, dpi, dpi != initial_dpi

        next_dpi = _next_lower_dpi(dpi)
        if next_dpi == dpi:
            return pages_data, dpi, dpi != initial_dpi
        dpi = next_dpi


def _handle_error(e: Exception) -> str:
    """Formatea errores de forma clara y accionable."""
    if isinstance(e, httpx.HTTPStatusError):
        code = e.response.status_code
        if code == 404:
            return "Error: PDF no encontrado en la URL proporcionada (404). Verifica que la URL sea correcta."
        elif code == 403:
            return "Error: Acceso denegado al PDF (403). El servidor requiere autenticación."
        elif code == 429:
            return "Error: Demasiadas solicitudes (429). Espera un momento antes de reintentar."
        return f"Error: Fallo al descargar el PDF (HTTP {code})."
    elif isinstance(e, httpx.TimeoutException):
        return "Error: Tiempo de espera agotado al descargar el PDF. Intenta con un timeout mayor."
    elif isinstance(e, httpx.ConnectError):
        return "Error: No se pudo conectar al servidor. Verifica la URL y tu conexión a internet."
    elif "poppler" in str(e).lower() or "pdfinfo" in str(e).lower():
        return "Error: Poppler no está instalado. Instálalo con: brew install poppler (Mac) o apt install poppler-utils (Linux)."
    return f"Error inesperado: {type(e).__name__}: {str(e)}"


async def _download_pdf(url: str) -> bytes:
    """Descarga un PDF desde una URL y retorna sus bytes."""
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, follow_redirects=True) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.content


# ─────────────────────────────────────────
# Input Models
# ─────────────────────────────────────────
class RenderPageInput(BaseModel):
    """Input para renderizar una o varias páginas de un PDF como imagen."""
    model_config = ConfigDict(
        str_strip_whitespace=True,
        validate_assignment=True,
        extra="forbid"
    )

    pdf_url: str = Field(
        ...,
        description="URL pública del PDF a procesar (ej: 'https://example.com/report.pdf')",
        min_length=10
    )
    page: Optional[int] = Field(
        default=1,
        description="Número de página a renderizar (1-based). Usa None para renderizar todas.",
        ge=1
    )
    dpi: Optional[int] = Field(
        default=DEFAULT_DPI,
        description=f"Resolución en DPI para el renderizado. Default: {DEFAULT_DPI}. Máximo: {MAX_DPI}.",
        ge=MIN_DPI,
        le=MAX_DPI
    )

    @field_validator("pdf_url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("La URL debe comenzar con http:// o https://")
        return v


class RenderPageROIInput(BaseModel):
    """Input para renderizar solo una sección (ROI) de una página de PDF."""
    model_config = ConfigDict(
        str_strip_whitespace=True,
        validate_assignment=True,
        extra="forbid"
    )

    pdf_url: str = Field(
        ...,
        description="URL pública del PDF a procesar",
        min_length=10
    )
    page: int = Field(
        default=1,
        description="Número de página a renderizar (1-based)",
        ge=1
    )
    roi_x_ratio: float = Field(
        ...,
        description="Posición X inicial de la ROI, relativo a la página [0, 1).",
        ge=0.0,
        lt=1.0
    )
    roi_y_ratio: float = Field(
        ...,
        description="Posición Y inicial de la ROI, relativo a la página [0, 1).",
        ge=0.0,
        lt=1.0
    )
    roi_width_ratio: float = Field(
        ...,
        description="Ancho de la ROI relativo a la página (0, 1].",
        gt=0.0,
        le=1.0
    )
    roi_height_ratio: float = Field(
        ...,
        description="Alto de la ROI relativo a la página (0, 1].",
        gt=0.0,
        le=1.0
    )

    @field_validator("pdf_url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("La URL debe comenzar con http:// o https://")
        return v

    @field_validator("roi_width_ratio")
    @classmethod
    def validate_width_ratio(cls, v: float, info) -> float:
        x = info.data.get("roi_x_ratio", 0.0)
        if (x + v) > 1.0:
            raise ValueError("roi_x_ratio + roi_width_ratio no puede superar 1.0")
        return v

    @field_validator("roi_height_ratio")
    @classmethod
    def validate_height_ratio(cls, v: float, info) -> float:
        y = info.data.get("roi_y_ratio", 0.0)
        if (y + v) > 1.0:
            raise ValueError("roi_y_ratio + roi_height_ratio no puede superar 1.0")
        return v


class RenderPagesRangeInput(BaseModel):
    """Input para renderizar un rango de páginas de un PDF."""
    model_config = ConfigDict(
        str_strip_whitespace=True,
        validate_assignment=True,
        extra="forbid"
    )

    pdf_url: str = Field(
        ...,
        description="URL pública del PDF a procesar",
        min_length=10
    )
    first_page: int = Field(
        default=1,
        description="Primera página del rango (1-based)",
        ge=1
    )
    last_page: int = Field(
        ...,
        description="Última página del rango (1-based, inclusiva)",
        ge=1
    )
    dpi: Optional[int] = Field(
        default=DEFAULT_DPI,
        description=f"Resolución en DPI. Default: {DEFAULT_DPI}.",
        ge=MIN_DPI,
        le=MAX_DPI
    )

    @field_validator("pdf_url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("La URL debe comenzar con http:// o https://")
        return v

    @field_validator("last_page")
    @classmethod
    def validate_range(cls, v: int, info) -> int:
        first = info.data.get("first_page", 1)
        if v < first:
            raise ValueError("last_page debe ser mayor o igual a first_page")
        if (v - first + 1) > MAX_PAGES_BATCH:
            raise ValueError(f"El rango no puede superar {MAX_PAGES_BATCH} páginas a la vez.")
        return v


class GetPageCountInput(BaseModel):
    """Input para obtener el número total de páginas de un PDF."""
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    pdf_url: str = Field(
        ...,
        description="URL pública del PDF",
        min_length=10
    )


# ─────────────────────────────────────────
# Tools
# ─────────────────────────────────────────
@mcp.tool(
    name="pdf_render_page",
    annotations={
        "title": "Renderizar página de PDF como imagen",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True
    }
)
async def pdf_render_page(params: RenderPageInput) -> str:
    """Descarga un PDF desde una URL y renderiza una página específica como imagen base64.

    Usa esta herramienta cuando necesites leer gráficas, tablas visuales, o cualquier
    contenido de imagen dentro de un PDF que el OCR de texto no pudo capturar.

    Args:
        params (RenderPageInput): Parámetros de entrada:
            - pdf_url (str): URL pública del PDF
            - page (int): Número de página a renderizar (default: 1)
            - dpi (int): Resolución del renderizado (default: 96)

    Returns:
        str: JSON con:
            - page (int): Número de página renderizada
            - width (int): Ancho de la imagen en píxeles
            - height (int): Alto de la imagen en píxeles
            - format (str): Formato de imagen (PNG)
            - image_base64 (str): Imagen codificada en base64
            - instructions (str): Indicación para que Claude analice la imagen
    """
    try:
        pdf_bytes = await _download_pdf(params.pdf_url)

        # El renderizado directo siempre inicia en perfil ligero para evitar
        # el cuello de botella de rasterizar primero en DPI alto.
        effective_dpi = min(params.dpi, LOW_QUALITY_DEFAULT_DPI)

        image, b64, used_dpi, dpi_adjusted = _render_single_page_with_fallback(
            pdf_bytes=pdf_bytes,
            page=params.page,
            initial_dpi=effective_dpi,
        )

        if image is None or b64 is None:
            return json.dumps({"error": f"No se encontró la página {params.page} en el PDF."})

        warning = None
        if params.dpi > effective_dpi:
            warning = (
                f"El DPI solicitado ({params.dpi}) se ajustó al perfil ligero "
                f"({effective_dpi}) para evitar cuellos de botella de renderizado."
            )
        elif dpi_adjusted:
            warning = (
                "La imagen inicial resultó demasiado grande y se redujo el DPI "
                f"de {effective_dpi} a {used_dpi}."
            )

        return json.dumps({
            "page": params.page,
            "width": image.width,
            "height": image.height,
            "format": DEFAULT_IMAGE_FORMAT,
            "dpi": used_dpi,
            "requested_dpi": params.dpi,
            "effective_initial_dpi": effective_dpi,
            "dpi_adjusted": dpi_adjusted,
            "image_base64": b64,
            "warning": warning,
            "instructions": (
                "La imagen está codificada en base64. "
                "Decodifícala y analiza visualmente su contenido para extraer "
                "los datos numéricos, textos o gráficas presentes."
            )
        })

    except Exception as e:
        return json.dumps({"error": _handle_error(e)})


@mcp.tool(
    name="pdf_render_page_roi_low_quality",
    annotations={
        "title": "Renderizar ROI en baja calidad",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True
    }
)
async def pdf_render_page_roi_low_quality(params: RenderPageROIInput) -> str:
    """Renderiza solo una sección (ROI) con menor DPI y compresión JPEG.

    Esta herramienta está pensada para ser la primera opción: minimiza píxeles
    y reduce el tamaño del base64 para análisis preliminar rápido.
    """
    try:
        pdf_bytes = await _download_pdf(params.pdf_url)

        image, _, used_dpi, dpi_adjusted = _render_single_page_with_fallback(
            pdf_bytes=pdf_bytes,
            page=params.page,
            initial_dpi=LOW_QUALITY_DEFAULT_DPI,
        )

        if image is None:
            return json.dumps({"error": f"No se encontró la página {params.page} en el PDF."})

        roi_image = _crop_image_by_ratio(
            image=image,
            x_ratio=params.roi_x_ratio,
            y_ratio=params.roi_y_ratio,
            width_ratio=params.roi_width_ratio,
            height_ratio=params.roi_height_ratio,
        )
        roi_b64 = _image_to_base64(
            roi_image,
            fmt=LOW_QUALITY_FORMAT,
            jpeg_quality=LOW_QUALITY_JPEG_QUALITY,
        )

        warning = None
        if dpi_adjusted:
            warning = (
                "La imagen inicial fue muy grande y el DPI se redujo automáticamente "
                f"a {used_dpi}."
            )

        return json.dumps({
            "page": params.page,
            "mode": "low_quality",
            "quality_profile": "roi-first",
            "dpi": used_dpi,
            "requested_dpi": LOW_QUALITY_DEFAULT_DPI,
            "dpi_adjusted": dpi_adjusted,
            "format": LOW_QUALITY_FORMAT,
            "jpeg_quality": LOW_QUALITY_JPEG_QUALITY,
            "roi": {
                "x_ratio": params.roi_x_ratio,
                "y_ratio": params.roi_y_ratio,
                "width_ratio": params.roi_width_ratio,
                "height_ratio": params.roi_height_ratio,
            },
            "width": roi_image.width,
            "height": roi_image.height,
            "image_base64": roi_b64,
            "warning": warning,
            "instructions": (
                "Esta imagen es un recorte ROI en baja calidad para revisión rápida. "
                "Si el detalle no es suficiente, usa la herramienta de alta calidad "
                "sobre la misma ROI."
            )
        })

    except Exception as e:
        return json.dumps({"error": _handle_error(e)})


@mcp.tool(
    name="pdf_render_page_roi_high_quality",
    annotations={
        "title": "Renderizar ROI en alta calidad",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True
    }
)
async def pdf_render_page_roi_high_quality(params: RenderPageROIInput) -> str:
    """Renderiza una ROI con mayor detalle para lectura fina o validación final."""
    try:
        pdf_bytes = await _download_pdf(params.pdf_url)

        image, _, used_dpi, dpi_adjusted = _render_single_page_with_fallback(
            pdf_bytes=pdf_bytes,
            page=params.page,
            initial_dpi=HIGH_QUALITY_DEFAULT_DPI,
        )

        if image is None:
            return json.dumps({"error": f"No se encontró la página {params.page} en el PDF."})

        roi_image = _crop_image_by_ratio(
            image=image,
            x_ratio=params.roi_x_ratio,
            y_ratio=params.roi_y_ratio,
            width_ratio=params.roi_width_ratio,
            height_ratio=params.roi_height_ratio,
        )
        roi_b64 = _image_to_base64(roi_image, fmt=HIGH_QUALITY_FORMAT)

        warning = None
        if dpi_adjusted:
            warning = (
                "La imagen en alta calidad superó los límites y se redujo DPI "
                f"automáticamente a {used_dpi}."
            )

        return json.dumps({
            "page": params.page,
            "mode": "high_quality",
            "quality_profile": "roi-detail",
            "dpi": used_dpi,
            "requested_dpi": HIGH_QUALITY_DEFAULT_DPI,
            "dpi_adjusted": dpi_adjusted,
            "format": HIGH_QUALITY_FORMAT,
            "roi": {
                "x_ratio": params.roi_x_ratio,
                "y_ratio": params.roi_y_ratio,
                "width_ratio": params.roi_width_ratio,
                "height_ratio": params.roi_height_ratio,
            },
            "width": roi_image.width,
            "height": roi_image.height,
            "image_base64": roi_b64,
            "warning": warning,
            "instructions": (
                "Esta imagen corresponde a la misma ROI en mayor calidad para "
                "extraer texto fino o validar valores difíciles de leer."
            )
        })

    except Exception as e:
        return json.dumps({"error": _handle_error(e)})


@mcp.tool(
    name="pdf_render_pages_range",
    annotations={
        "title": "Renderizar rango de páginas de PDF",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True
    }
)
async def pdf_render_pages_range(params: RenderPagesRangeInput) -> str:
    """Renderiza un rango de páginas de un PDF como imágenes base64.

    Útil cuando necesitas explorar varias páginas seguidas sin conocer
    exactamente en cuál está el dato que buscas. Máximo 10 páginas por llamada.

    Args:
        params (RenderPagesRangeInput): Parámetros:
            - pdf_url (str): URL del PDF
            - first_page (int): Primera página del rango
            - last_page (int): Última página del rango (máx. 10 páginas)
            - dpi (int): Resolución (default: 200)

    Returns:
        str: JSON con lista de páginas, cada una con:
            - page (int): Número de página
            - width, height (int): Dimensiones
            - image_base64 (str): Imagen en base64
    """
    try:
        pdf_bytes = await _download_pdf(params.pdf_url)

        # Mantener el modo directo en DPI bajo para evitar cuellos de botella.
        effective_dpi = min(params.dpi, LOW_QUALITY_DEFAULT_DPI)

        pages_data, used_dpi, dpi_adjusted = _render_pages_range_with_fallback(
            pdf_bytes=pdf_bytes,
            first_page=params.first_page,
            last_page=params.last_page,
            initial_dpi=effective_dpi,
        )

        if not pages_data:
            return json.dumps({"error": "No se encontraron páginas en el rango indicado."})

        warning = None
        if params.dpi > effective_dpi:
            warning = (
                f"El DPI solicitado ({params.dpi}) se ajustó al perfil ligero "
                f"({effective_dpi}) para evitar cuellos de botella de renderizado."
            )
        elif dpi_adjusted:
            warning = (
                "Al menos una imagen del rango fue demasiado grande, "
                f"por lo que se redujo el DPI de {effective_dpi} a {used_dpi}."
            )

        return json.dumps({
            "total_rendered": len(pages_data),
            "range": f"{params.first_page}-{params.last_page}",
            "dpi": used_dpi,
            "requested_dpi": params.dpi,
            "effective_initial_dpi": effective_dpi,
            "dpi_adjusted": dpi_adjusted,
            "warning": warning,
            "pages": pages_data
        })

    except Exception as e:
        return json.dumps({"error": _handle_error(e)})


@mcp.tool(
    name="pdf_get_page_count",
    annotations={
        "title": "Obtener número de páginas de un PDF",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True
    }
)
async def pdf_get_page_count(params: GetPageCountInput) -> str:
    """Obtiene el número total de páginas de un PDF sin renderizarlo completo.

    Usa esta herramienta primero para conocer el tamaño del documento
    antes de decidir qué páginas renderizar.

    Args:
        params (GetPageCountInput):
            - pdf_url (str): URL del PDF

    Returns:
        str: JSON con:
            - page_count (int): Total de páginas del PDF
            - pdf_url (str): URL consultada
    """
    try:
        pdf_bytes = await _download_pdf(params.pdf_url)

        # Renderizar solo la primera página para obtener el total
        # pdfinfo es más eficiente pero requiere que poppler esté en PATH
        from pdf2image.pdf2image import pdfinfo_from_bytes
        info = pdfinfo_from_bytes(pdf_bytes)
        page_count = info.get("Pages", "desconocido")

        return json.dumps({
            "page_count": page_count,
            "pdf_url": params.pdf_url
        })

    except Exception as e:
        return json.dumps({"error": _handle_error(e)})


# ─────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────
if __name__ == "__main__":
    mcp.run()