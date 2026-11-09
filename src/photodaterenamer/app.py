"""Application entry point."""

from __future__ import annotations

import os
import threading
import webbrowser

from .server import AppServer


def main() -> None:
    port_setting = os.environ.get("PHOTODATERENAMER_PORT", "0")
    try:
        port = int(port_setting)
    except ValueError:
        raise SystemExit(f"PHOTODATERENAMER_PORT no es un número de puerto válido: {port_setting}")
    with AppServer(port) as server:
        url = f"http://127.0.0.1:{server.server_port}/"
        print(f"PhotoDateRenamer está listo: {url}", flush=True)
        if os.environ.get("PHOTODATERENAMER_NO_BROWSER") != "1":
            threading.Timer(0.7, webbrowser.open, args=(url,)).start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nCerrando PhotoDateRenamer...")


if __name__ == "__main__":
    main()
