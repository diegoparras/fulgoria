# Vuelca la estructura real de un PDF: páginas, y por página las líneas de texto
# con sus coordenadas (agrupadas por 'top'). Solo para análisis local de desarrollo.
import sys
import pdfplumber

path = sys.argv[1]
with pdfplumber.open(path) as pdf:
    print(f"PAGINAS: {len(pdf.pages)}")
    for pi, page in enumerate(pdf.pages):
        W, H = page.width, page.height
        words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
        # Agrupar por línea (top redondeado)
        lines = {}
        for w in words:
            key = round(w["top"] / 3) * 3
            lines.setdefault(key, []).append(w)
        print(f"\n===== PAGINA {pi+1}  ({W:.0f} x {H:.0f} pt)  {len(words)} palabras =====")
        for top in sorted(lines):
            ws = sorted(lines[top], key=lambda w: w["x0"])
            # x0 normalizado para ver bandas de columna
            cells = " | ".join(f"{w['text']}@{w['x0']/W:.3f}" for w in ws)
            print(f"  y={top/H:.3f}  {cells}")
