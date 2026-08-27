import http.server
import socketserver
import webbrowser
import os
import sys

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

def main():
    os.chdir(DIRECTORY)
    # Allow port reuse
    socketserver.TCPServer.allow_reuse_address = True
    
    url = f"http://localhost:{PORT}/index.html"
    print("=" * 60)
    print(" 🚀 CONTROL DE GASTOS DE VIAJES INTERNACIONALES")
    print(f" Servidor iniciado en: {url}")
    print(" Pulsa Ctrl+C en esta terminal para detener el servidor.")
    print("=" * 60)

    # Open browser automatically
    webbrowser.open(url)

    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServidor detenido.")
            sys.exit(0)

if __name__ == '__main__':
    main()
