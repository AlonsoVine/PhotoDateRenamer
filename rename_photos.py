import os
from PIL import Image
from PIL.ExifTags import TAGS
from datetime import datetime

def obtener_fecha_tomada(imagen_path):
    # Abrir la imagen
    imagen = Image.open(imagen_path)
    exif_data = imagen._getexif()

    if exif_data is not None:
        # Buscar la fecha en los metadatos
        for tag, value in exif_data.items():
            tag_nombre = TAGS.get(tag, tag)
            if tag_nombre == 'DateTimeOriginal':  # Buscar fecha original
                return value
    return None

def formatear_fecha(fecha_exif):
    # Convertir la fecha EXIF al formato YYYY_MM_DD
    fecha_obj = datetime.strptime(fecha_exif, "%Y:%m:%d %H:%M:%S")
    return fecha_obj.strftime("%Y_%m_%d")

def renombrar_fotos_en_directorio(directorio):
    for archivo in os.listdir(directorio):
        archivo_path = os.path.join(directorio, archivo)

        # Solo trabajar con archivos de imagen (puedes ajustar los formatos si es necesario)
        if archivo.lower().endswith(('.jpg', '.jpeg', '.png', '.tiff')):
            fecha_tomada = obtener_fecha_tomada(archivo_path)
            
            if fecha_tomada:
                fecha_formateada = formatear_fecha(fecha_tomada)
                nuevo_nombre = f"{fecha_formateada}_{archivo}"
                nuevo_path = os.path.join(directorio, nuevo_nombre)

                # Renombrar el archivo
                os.rename(archivo_path, nuevo_path)
                print(f"Renombrado: {archivo} -> {nuevo_nombre}")
            else:
                print(f"No se encontró la fecha para {archivo}")

# Cambia 'directorio_de_fotos' al directorio donde están tus fotos
directorio_de_fotos = './'  # O la ruta que prefieras
renombrar_fotos_en_directorio(directorio_de_fotos)
