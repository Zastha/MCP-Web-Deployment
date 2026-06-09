"""
test_mcp.py - Prueba el pdf_vision_mcp directamente desde la terminal,
sin necesitar Claude Desktop ni ningún cliente MCP.

Uso:
    python test_mcp.py                          # Prueba básica con PDF de ejemplo
    python test_mcp.py --url URL --page N       # PDF específico
    python test_mcp.py --url URL --count        # Solo contar páginas
    python test_mcp.py --url URL --range 1 5    # Rango de páginas

Ejemplos:
    python test_mcp.py --url https://www.inegi.org.mx/contenidos/programas/enut/2024/doc/enut_2024_presentacion_resultados.pdf --page 8
    python test_mcp.py --url https://www.w3.org/WAI/WCAG21/wcag21.pdf --count
"""

import asyncio
import argparse
import json
import base64
import sys
import os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from server import (
    pdf_render_page,
    pdf_render_pages_range,
    pdf_get_page_count,
    RenderPageInput,
    RenderPagesRangeInput,
    GetPageCountInput
)


def save_image(b64_data: str, filename: str) -> str:
    """Guarda una imagen base64 en disco y retorna la ruta."""
    output_dir = Path("./output_images")
    output_dir.mkdir(exist_ok=True)
    filepath = output_dir / filename
    with open(filepath, "wb") as f:
        f.write(base64.b64decode(b64_data))
    return str(filepath)


def print_result(result_json: str, save_images: bool = True) -> None:
    """Imprime el resultado de forma legible y guarda imágenes."""
    try:
        data = json.loads(result_json)
    except json.JSONDecodeError:
        print(f"Respuesta (no JSON): {result_json}")
        return

    if "error" in data:
        print(f"\n❌ ERROR: {data['error']}")
        return

    # Resultado de page_count
    if "page_count" in data and "pages" not in data:
        print(f"\n✅ Total de páginas: {data['page_count']}")
        print(f"   PDF: {data.get('pdf_url', '')}")
        return

    # Resultado de página única
    if "image_base64" in data and "pages" not in data:
        print(f"\n✅ Página {data['page']} renderizada correctamente")
        print(f"   Dimensiones: {data['width']} x {data['height']} px")
        print(f"   DPI: {data.get('dpi', 'N/A')}")
        print(f"   Formato: {data.get('format', 'PNG')}")
        print(f"   Tamaño base64: {len(data['image_base64'])} chars (~{len(data['image_base64']) * 3 // 4 // 1024} KB)")

        if save_images:
            path = save_image(data["image_base64"], f"page_{data['page']}.png")
            print(f"   💾 Imagen guardada en: {path}")

        # Mostrar solo los primeros 100 chars del base64
        preview = data["image_base64"][:100] + "..."
        print(f"\n   Base64 preview: {preview}")
        return

    # Resultado de rango de páginas
    if "pages" in data:
        print(f"\n✅ Rango {data.get('range')} renderizado: {data['total_rendered']} páginas")
        print(f"   DPI: {data.get('dpi', 'N/A')}")
        for page_data in data["pages"]:
            print(f"\n   📄 Página {page_data['page']}: {page_data['width']}x{page_data['height']} px")
            if save_images:
                path = save_image(page_data["image_base64"], f"page_{page_data['page']}.png")
                print(f"      💾 Guardada en: {path}")
        return

    # Fallback: imprimir todo excepto base64
    safe_data = {k: v for k, v in data.items() if "base64" not in k}
    print(f"\nResultado: {json.dumps(safe_data, indent=2, ensure_ascii=False)}")


async def test_page_count(url: str):
    """Test: obtener número de páginas."""
    print(f"\n{'='*60}")
    print(f"TEST: Conteo de páginas")
    print(f"URL: {url}")
    print(f"{'='*60}")

    result = await pdf_get_page_count(GetPageCountInput(pdf_url=url))
    print_result(result, save_images=False)


async def test_render_page(url: str, page: int = 1, dpi: int = 200):
    """Test: renderizar una página."""
    print(f"\n{'='*60}")
    print(f"TEST: Renderizar página {page}")
    print(f"URL: {url}")
    print(f"DPI: {dpi}")
    print(f"{'='*60}")

    result = await pdf_render_page(RenderPageInput(
        pdf_url=url,
        page=page,
        dpi=dpi
    ))
    print_result(result)


async def test_render_range(url: str, first: int, last: int, dpi: int = 150):
    """Test: renderizar rango de páginas."""
    print(f"\n{'='*60}")
    print(f"TEST: Renderizar páginas {first} a {last}")
    print(f"URL: {url}")
    print(f"{'='*60}")

    result = await pdf_render_pages_range(RenderPagesRangeInput(
        pdf_url=url,
        first_page=first,
        last_page=last,
        dpi=dpi
    ))
    print_result(result)


async def run_all_tests():
    """Suite de tests usando un PDF público pequeño."""
    # PDF público de prueba (pequeño y accesible)
    test_url = "https://www.w3.org/TR/2008/REC-WCAG20-20081211/WCAG20.pdf"

    print("\n🧪 INICIANDO SUITE DE PRUEBAS - pdf_vision_mcp")
    print(f"PDF de prueba: {test_url}\n")

    # Test 1: Contar páginas
    await test_page_count(test_url)

    # Test 2: Renderizar primera página
    await test_render_page(test_url, page=1, dpi=150)

    # Test 3: Renderizar rango pequeño
    await test_render_range(test_url, first=1, last=2, dpi=150)

    print(f"\n{'='*60}")
    print("✅ Tests completados. Revisa ./output_images/ para ver las imágenes.")
    print(f"{'='*60}\n")


def main():
    parser = argparse.ArgumentParser(
        description="Prueba el MCP pdf_vision directamente desde la terminal",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument("--url", type=str, help="URL del PDF a procesar")
    parser.add_argument("--page", type=int, default=1, help="Número de página (default: 1)")
    parser.add_argument("--dpi", type=int, default=200, help="DPI del renderizado (default: 200)")
    parser.add_argument("--count", action="store_true", help="Solo contar páginas del PDF")
    parser.add_argument("--range", type=int, nargs=2, metavar=("FIRST", "LAST"),
                        help="Renderizar rango de páginas (ej: --range 1 5)")
    parser.add_argument("--all-tests", action="store_true",
                        help="Ejecutar suite completa de tests con PDF de ejemplo")

    args = parser.parse_args()

    # Sin argumentos → suite completa de tests
    if args.all_tests or (not args.url and not args.all_tests):
        asyncio.run(run_all_tests())
        return

    if args.count:
        asyncio.run(test_page_count(args.url))
    elif args.range:
        asyncio.run(test_render_range(args.url, args.range[0], args.range[1], args.dpi))
    else:
        asyncio.run(test_render_page(args.url, args.page, args.dpi))


if __name__ == "__main__":
    main()