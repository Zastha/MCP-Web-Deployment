# pdf-vision-mcp

MCP que convierte páginas de PDF a imágenes base64 para que Claude pueda
analizar gráficas, tablas visuales y cualquier contenido que el OCR de texto no captura.

## Instalación

### 1. Instalar Poppler (requerido por pdf2image)

**Mac:**
```bash
brew install poppler
```

**Ubuntu/Debian:**
```bash
sudo apt install poppler-utils
```

**Windows:**
Descarga los binarios desde https://github.com/oschwartz10612/poppler-windows/releases
y agrega la carpeta `bin/` al PATH del sistema.

### 2. Instalar dependencias Python

```bash
pip install -r requirements.txt
```

---

## Probar sin Claude Desktop

```bash
# Suite completa de tests (usa PDF público de ejemplo)
python test_mcp.py

# Contar páginas de un PDF
python test_mcp.py --url https://example.com/doc.pdf --count

# Renderizar página específica
python test_mcp.py --url https://example.com/doc.pdf --page 8

# Renderizar rango de páginas
python test_mcp.py --url https://example.com/doc.pdf --range 5 10

# Mayor resolución
python test_mcp.py --url https://example.com/doc.pdf --page 8 --dpi 300
```

Las imágenes se guardan automáticamente en `./output_images/` para que puedas
verificarlas visualmente.

---

## Conectar con Claude Desktop

Agrega esto en tu `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pdf-vision": {
      "command": "python",
      "args": ["/ruta/completa/a/pdf-vision-mcp/server.py"]
    }
  }
}
```

**Ubicación del archivo de configuración:**
- Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

---

## Herramientas disponibles

| Herramienta | Descripción |
|---|---|
| `pdf_get_page_count` | Obtiene el número total de páginas de un PDF |
| `pdf_render_page` | Renderiza una página específica como imagen base64 |
| `pdf_render_pages_range` | Renderiza un rango de páginas (máx. 10 a la vez) |
| `pdf_render_page_roi_low_quality` | Renderiza solo la sección de interés (ROI) en baja calidad y menor tamaño base64 |
| `pdf_render_page_roi_high_quality` | Renderiza la misma ROI en alta calidad para validación final |

### Flujo recomendado ROI (rápido -> detallado)

1. Usa `pdf_render_page_roi_low_quality` para ubicar la sección donde vive el dato.
2. A partir de esa lectura, ajusta el recorte exacto de la ROI.
3. Llama `pdf_render_page_roi_high_quality` sobre la misma ROI ya delimitada para la lectura final.

Parámetros ROI (relativos a la página, rango 0-1):

- `roi_x_ratio`: inicio horizontal
- `roi_y_ratio`: inicio vertical
- `roi_width_ratio`: ancho relativo
- `roi_height_ratio`: alto relativo

---

## Caso de uso principal

Este MCP fue creado para resolver el problema de PDFs con gráficas que
Mistral OCR no puede extraer como texto. El flujo típico es:

```
1. Mistral OCR procesa el PDF → detecta imagen pero devuelve image_base64: null
2. pdf_vision_mcp renderiza esa página específica → devuelve imagen como base64
3. Claude analiza la imagen con visión nativa → extrae los valores numéricos
```
