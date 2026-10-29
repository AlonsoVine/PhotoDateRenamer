"""Native folder picker adapters."""

import ctypes
import platform
import tkinter
from tkinter import filedialog


def select_windows_folder() -> str:
    if platform.system() != "Windows":
        raise OSError("El selector nativo solo está disponible en Windows.")

    class BrowseInfo(ctypes.Structure):
        _fields_ = [
            ("hwndOwner", ctypes.c_void_p),
            ("pidlRoot", ctypes.c_void_p),
            ("pszDisplayName", ctypes.c_wchar_p),
            ("lpszTitle", ctypes.c_wchar_p),
            ("ulFlags", ctypes.c_uint),
            ("lpfn", ctypes.c_void_p),
            ("lParam", ctypes.c_ssize_t),
            ("iImage", ctypes.c_int),
        ]

    shell = ctypes.windll.shell32
    shell.SHBrowseForFolderW.argtypes = [ctypes.POINTER(BrowseInfo)]
    shell.SHBrowseForFolderW.restype = ctypes.c_void_p
    shell.SHGetPathFromIDListW.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_wchar),
    ]
    shell.SHGetPathFromIDListW.restype = ctypes.c_int
    user32 = ctypes.windll.user32
    ole32 = ctypes.windll.ole32
    ole32.CoInitializeEx.argtypes = [ctypes.c_void_p, ctypes.c_uint]
    ole32.CoInitializeEx.restype = ctypes.c_long
    ole32.CoUninitialize.argtypes = []
    ole32.CoTaskMemFree.argtypes = [ctypes.c_void_p]
    buffer = ctypes.create_unicode_buffer(32768)
    info = BrowseInfo(
        hwndOwner=user32.GetForegroundWindow(),
        pidlRoot=None,
        pszDisplayName=ctypes.cast(buffer, ctypes.c_wchar_p),
        lpszTitle="Elige la carpeta de fotos",
        ulFlags=0x0001 | 0x0040,
        lpfn=None,
        lParam=0,
        iImage=0,
    )
    result = ole32.CoInitializeEx(None, 0x2)
    if result < 0:
        raise OSError(f"No se pudo inicializar el selector de carpetas de Windows: {result}")
    try:
        item_id = shell.SHBrowseForFolderW(ctypes.byref(info))
        if not item_id:
            return ""
        try:
            if not shell.SHGetPathFromIDListW(item_id, buffer):
                raise OSError("Windows no pudo obtener la ruta de la carpeta seleccionada.")
            return buffer.value
        finally:
            ole32.CoTaskMemFree(item_id)
    finally:
        ole32.CoUninitialize()


def _select_tk_folder() -> str:
    root = tkinter.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
        root.update_idletasks()
        root.update()
        return filedialog.askdirectory(
            parent=root,
            title="Elige la carpeta de fotos",
            mustexist=True,
        )
    finally:
        root.destroy()


def main() -> None:
    selected = select_windows_folder() if platform.system() == "Windows" else _select_tk_folder()
    print(selected, flush=True)


if __name__ == "__main__":
    main()
