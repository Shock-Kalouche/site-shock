"""Petit serveur local pour le site (nécessaire à la connexion Discord).

Il sert uniquement les fichiers de ce dossier, sur cet ordinateur
(http://localhost:8080/). Rien n'est accessible depuis Internet.
Arrêt : fermer la fenêtre ou Ctrl+C.
"""
import http.server
import os
import socketserver
import sys
import threading
import webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".css": "text/css",
        ".html": "text/html",
    }

    def end_headers(self):
        # Pas de cache : les modifications de l'éditeur apparaissent tout de suite
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


try:
    httpd = Server(("127.0.0.1", PORT), Handler)
except OSError:
    print(f"Le port {PORT} est déjà utilisé (le site tourne peut-être déjà dans une autre fenêtre).")
    print(f"Ouvre http://localhost:{PORT}/ dans ton navigateur.")
    sys.exit(1)

url = f"http://localhost:{PORT}/"
print("Site Shock Trooper en ligne sur cet ordinateur :", url)
print("Laisse cette fenêtre ouverte tant que tu utilises le site. Ferme-la pour l'arrêter.")
threading.Timer(0.8, lambda: webbrowser.open(url)).start()
try:
    httpd.serve_forever()
except KeyboardInterrupt:
    pass
